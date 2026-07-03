// Pure, typed generation logic for the npm-publish action.
//
// Pipeline: raw goreleaser artifacts --discoverArchives--> Archive[]; then
// planRelease(consumer, archives) --> the entire release as data (one manifest
// per platform package + the derived main package.json). publish.ts is pure
// I/O over that plan. Translation between goreleaser and npm/Node coordinate
// systems happens exactly once, at discovery (see toPlatform).
//
// Naming vs field split (see PRD): the platform package *name* uses
// goreleaser's raw `goos` token (linux/darwin/windows) so it matches the
// package names already registered for OIDC trusted publishing. The npm `os`
// *field* uses Node's value (win32), which npm uses for optional-dependency
// install gating. Only Windows diverges between the two.

import { z } from "zod";

// --- Platform coordinate systems -------------------------------------------
//
// Four columns, two translations. `linux`/`darwin` are identical across name
// and field; only `windows` -> `win32` diverges (see PRD R1/R2). Each const
// array is the single source of truth: it supplies the literal type AND (via
// z.enum) the parse-time validator, so an unknown token cannot slip past
// discovery into a later lookup.
const GOOS = ["linux", "darwin", "windows"] as const;
const GOARCH = ["amd64", "arm64", "386", "arm"] as const;
export type Goos = (typeof GOOS)[number];
export type Goarch = (typeof GOARCH)[number];

// Node `process.platform` (npm `os` field + map key) and npm arch tokens.
type NodeOs = "linux" | "darwin" | "win32";
type NpmCpu = "x64" | "arm64" | "ia32" | "arm";
type PlatformKey = `${NodeOs}-${NpmCpu}`;

// `Record<Goos, …>` forces total, exhaustive coverage: adding a goos without a
// mapping is a compile error.
const NODE_OS: Record<Goos, NodeOs> = { linux: "linux", darwin: "darwin", windows: "win32" };
const NPM_CPU: Record<Goarch, NpmCpu> = { amd64: "x64", arm64: "arm64", "386": "ia32", arm: "arm" };

// A resolved target platform, every derived token computed once. `nameToken`
// is the raw goos for the package name; `os`/`cpu` are the npm fields; `key` is
// the runtime `${platform}-${arch}` map key.
export interface Platform {
  readonly nameToken: Goos;
  readonly os: NodeOs;
  readonly cpu: NpmCpu;
  readonly key: PlatformKey;
}

// The single translation from goreleaser coordinates to a Platform.
function toPlatform(goos: Goos, goarch: Goarch): Platform {
  const os = NODE_OS[goos];
  const cpu = NPM_CPU[goarch];
  return { nameToken: goos, os, cpu, key: `${os}-${cpu}` };
}

// --- Types ------------------------------------------------------------------

export interface Archive {
  readonly path: string;
  readonly format: string;
  readonly binary: string;
  readonly platform: Platform;
}

export interface PlatformPackage {
  name: string;
  version: string;
  os: [NodeOs];
  cpu: [NpmCpu];
  files: [string];
  license: string;
  repository: { type: "git"; url: string };
}

// The complete release as data: one manifest per platform package (paired with
// the archive it is built from, for binary extraction) plus the derived main
// package.json. Consumed by publish.ts; nothing here does I/O.
export interface PublishPlan {
  readonly platforms: ReadonlyArray<{ archive: Archive; manifest: PlatformPackage }>;
  readonly main: Record<string, unknown>;
}

// Consumer main package.json. A non-empty `name` is required so the file is a
// valid manifest, but its value is IGNORED (the main package name is derived
// from opts.base). LOOSE: unknown metadata (description/homepage/...) survives
// parsing and is spread into the derived package untouched.
const ConsumerSchema = z.looseObject({
  name: z.string().min(1, 'must declare a non-empty "name"'),
  files: z.array(z.string()).optional(),
  engines: z.record(z.string(), z.string()).optional(),
  chinmina: z.object({ command: z.string().optional() }).optional(),
});
export type Consumer = z.infer<typeof ConsumerSchema>;

// --- Parsing ----------------------------------------------------------------

// The one parse-or-explain idiom, shared by env/consumer/etc. Throws a readable
// error naming the offending field(s) on failure.
export function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`${label}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function parseConsumer(raw: unknown): Consumer {
  return parseOrThrow(ConsumerSchema, raw, "main package.json is invalid");
}

// --- Discovery --------------------------------------------------------------

// Is this artifact a binary-bearing Archive at all? Source archives, checksums,
// etc. fail this and are skipped. A matched Archive with an unknown platform is
// then rejected loudly (fail-fast, R4) by the enum fields below.
const ArchiveShapeSchema = z.object({
  type: z.literal("Archive"),
  extra: z.object({ Binaries: z.array(z.string()).min(1) }),
});

// The transform normalizes the raw goreleaser shape into the domain Archive, so
// no downstream code re-reads goos/goarch or `extra`.
const ArchiveEntrySchema = z
  .object({
    type: z.literal("Archive"),
    path: z.string(),
    goos: z.enum(GOOS),
    goarch: z.enum(GOARCH),
    extra: z.object({ Format: z.string(), Binaries: z.array(z.string()).min(1) }),
  })
  .transform((a): Archive => ({
    path: a.path,
    format: a.extra.Format,
    binary: a.extra.Binaries[0]!,
    platform: toPlatform(a.goos, a.goarch),
  }));

// Best-effort label for an artifact whose full shape has not been validated,
// used only for error messages (no cast: narrows unknown structurally).
function artifactPath(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "path" in raw && typeof raw.path === "string") {
    return raw.path;
  }
  return "<unknown>";
}

// Discover the platform archives to publish, normalized to the domain Archive.
export function discoverArchives(artifacts: unknown): Archive[] {
  const out: Archive[] = [];
  for (const raw of z.array(z.unknown()).parse(artifacts)) {
    if (!ArchiveShapeSchema.safeParse(raw).success) continue; // not ours -> skip
    out.push(parseOrThrow(ArchiveEntrySchema, raw, `unsupported archive ${artifactPath(raw)}`));
  }
  return out;
}

// --- Planning ---------------------------------------------------------------

// Strip an npm scope (`@scope/name` -> `name`).
const unscopedName = (name: string): string => name.slice(name.indexOf("/") + 1);

// Platform package name: `<base>-<goos>-<npm-cpu>` (goos token stays raw).
const packageName = (base: string, p: Platform): string => `${base}-${p.nameToken}-${p.cpu}`;

// Build the entire release as data. The main package is the consumer spread
// first (preserving consumer-owned metadata) with derived fields overriding.
// `name` is derived from opts.base — the single source of truth for the whole
// package family — so the main package cannot diverge from the platform
// packages / optionalDependencies / chinmina map it references.
export function planRelease(
  consumer: Consumer,
  archives: Archive[],
  opts: { base: string; version: string; repoUrl: string; launcher: string },
): PublishPlan {
  if (archives.length === 0) {
    throw new Error(
      "no qualifying Archive entries found in artifacts.json " +
        "(need type==Archive with at least one binary)",
    );
  }
  const { base, version, repoUrl, launcher } = opts;
  const repository = { type: "git", url: repoUrl } as const;

  const platforms = archives.map((archive) => ({
    archive,
    manifest: {
      name: packageName(base, archive.platform),
      version,
      os: [archive.platform.os],
      cpu: [archive.platform.cpu],
      files: [archive.binary],
      license: "MIT",
      repository,
    } satisfies PlatformPackage,
  }));

  const command = consumer.chinmina?.command ?? unscopedName(base);
  const main = {
    ...consumer,
    name: base,
    version,
    repository,
    bin: { [command]: `./${launcher}` },
    optionalDependencies: Object.fromEntries(platforms.map((p) => [p.manifest.name, version])),
    files: [...new Set([launcher, "README.md", ...(consumer.files ?? [])])],
    engines: consumer.engines ?? { node: ">=18" },
    // Data-driven launcher map (replaces any consumer-supplied chinmina block).
    chinmina: {
      platforms: Object.fromEntries(
        platforms.map((p) => [p.archive.platform.key, { package: p.manifest.name, bin: p.archive.binary }]),
      ),
    },
  };

  return { platforms, main };
}
