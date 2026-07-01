#!/usr/bin/env bun
//
// Single entrypoint for the npm-publish action: discover archives, validate
// ALL consumer input up front (fail-fast, before any publish), then publish
// each platform package and finally the main shim.
//
// Runs under Bun. Bun packs the tarball directory; the actual publish is done
// by `npm publish` because npm OIDC trusted publishing (provenance, no stored
// token) is an npm-CLI feature. Bun never publishes.

import { $ } from "bun";
import { chmodSync, cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  ConsumerSchema,
  discoverArchives,
  mainPackage,
  platformPackage,
  validateArchives,
  validateConsumer,
  validateMappings,
  type DiscoveredArchive,
} from "./npm-publish.ts";

const LAUNCHER = "launcher.cjs";

const EnvSchema = z.object({
  ACTION_PATH: z.string().min(1),
  PACKAGE_NAME: z.string().min(1),
  ARTIFACTS_JSON: z.string().min(1),
  MAIN_PACKAGE_DIR: z.string().min(1),
  VERSION: z.string().min(1),
  README: z.string().optional().default(""),
  GITHUB_SERVER_URL: z.string().min(1),
  GITHUB_REPOSITORY: z.string().min(1),
});

function fail(message: string): never {
  console.error(`::error title=npm-publish::${message}`);
  process.exit(1);
}

const tmpdirs: string[] = [];
function makeTmpdir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpdirs.push(dir);
  return dir;
}
function cleanup(): void {
  for (const dir of tmpdirs) rmSync(dir, { recursive: true, force: true });
}

async function extractBinary(entry: DiscoveredArchive, dir: string): Promise<void> {
  if (entry.format === "zip") {
    await $`unzip -j ${entry.path} ${entry.binary} -d ${dir}`;
  } else {
    await $`tar -xzf ${entry.path} -C ${dir} ${entry.binary}`;
  }
  chmodSync(join(dir, entry.binary), 0o755);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(value, null, 2) + "\n");
}

async function main(): Promise<void> {
  const parsedEnv = EnvSchema.safeParse(process.env);
  if (!parsedEnv.success) {
    fail(`missing/invalid environment:\n${z.prettifyError(parsedEnv.error)}`);
  }
  const env = parsedEnv.data;

  const base = env.PACKAGE_NAME;
  const version = env.VERSION.replace(/^v/, "");
  const repoUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`;
  const tagArgs = version.includes("-") ? ["--tag", "next"] : [];

  // --- Preflight: validate everything before the first publish -------------
  const consumerPath = join(env.MAIN_PACKAGE_DIR, "package.json");
  if (!existsSync(consumerPath)) {
    fail(`main package.json not found at ${consumerPath}`);
  }

  let consumer: Record<string, unknown>;
  let entries: DiscoveredArchive[];
  try {
    consumer = JSON.parse(await Bun.file(consumerPath).text());
    validateConsumer(consumer);
    entries = discoverArchives(JSON.parse(await Bun.file(env.ARTIFACTS_JSON).text()));
    validateArchives(entries);
    validateMappings(entries);
  } catch (err) {
    fail((err as Error).message);
  }

  // --- Publish each platform package ---------------------------------------
  for (const entry of entries) {
    const dir = makeTmpdir("npm-plat-");
    await extractBinary(entry, dir);
    const pkg = platformPackage(entry, { base, version, repoUrl });
    await writeJson(join(dir, "package.json"), pkg);
    await $`npm publish --access public ${tagArgs} ${dir}`;
    console.log(`published ${pkg.name}@${version}`);
  }

  // --- Publish the main shim last ------------------------------------------
  // Its optionalDependencies reference the platform packages above. The generic
  // launcher is copied in from the action (consumers ship none).
  const mainDir = makeTmpdir("npm-main-");
  cpSync(env.MAIN_PACKAGE_DIR, mainDir, { recursive: true });
  cpSync(join(env.ACTION_PATH, LAUNCHER), join(mainDir, LAUNCHER));
  if (env.README && existsSync(env.README)) {
    cpSync(env.README, join(mainDir, "README.md"));
  }
  const derived = mainPackage(consumer, {
    entries,
    version,
    repoUrl,
    base,
    launcher: LAUNCHER,
  });
  await writeJson(join(mainDir, "package.json"), derived);
  await $`npm publish --access public ${tagArgs} ${mainDir}`;
  console.log(`published ${base}@${version}`);
}

try {
  await main();
} finally {
  cleanup();
}
