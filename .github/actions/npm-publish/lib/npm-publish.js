'use strict';

// Pure, testable generation logic for the npm-publish action.
//
// Naming vs field split (see PRD): the platform package *name* uses
// goreleaser's raw `goos` token (linux/darwin/windows) so it matches the
// package names already registered for OIDC trusted publishing. The npm `os`
// *field* uses Node's value (win32), which npm uses for optional-dependency
// install gating. Only Windows diverges between the two.

// goreleaser goos -> Node process.platform value (used for the `os` field and
// the runtime platform-map key).
const NODE_OS = {
  linux: 'linux',
  darwin: 'darwin',
  windows: 'win32',
};

// goreleaser goarch -> npm arch token (used for both the name arch token and
// the `cpu` field; they legitimately coincide).
const NPM_CPU = {
  amd64: 'x64',
  arm64: 'arm64',
  386: 'ia32',
  arm: 'arm',
};

const DEFAULT_FILES = ['launcher.cjs', 'README.md'];
const DEFAULT_LAUNCHER = 'launcher.cjs';
const DEFAULT_ENGINES = { node: '>=18' };

function nodeOs(goos) {
  const os = NODE_OS[goos];
  if (!os) {
    throw new Error(`unknown goos '${goos}'`);
  }
  return os;
}

function npmCpu(goarch) {
  const cpu = NPM_CPU[goarch];
  if (!cpu) {
    throw new Error(`unknown goarch '${goarch}'`);
  }
  return cpu;
}

// Strip an npm scope (`@scope/name` -> `name`).
function unscopedName(name) {
  const slash = name.indexOf('/');
  return slash === -1 ? name : name.slice(slash + 1);
}

// Discover the platform archives to publish: Archive entries carrying at least
// one binary (source archives and other artifact types are excluded).
function discoverArchives(artifacts) {
  if (!Array.isArray(artifacts)) {
    throw new Error('artifacts.json did not contain a JSON array');
  }
  return artifacts
    .filter(
      (a) =>
        a &&
        a.type === 'Archive' &&
        a.extra &&
        Array.isArray(a.extra.Binaries) &&
        a.extra.Binaries.length > 0,
    )
    .map((a) => ({
      path: a.path,
      format: a.extra.Format,
      goos: a.goos,
      goarch: a.goarch,
      binary: a.extra.Binaries[0],
    }));
}

// Platform package name: `<base>-<goos>-<npm-cpu>` (goos token stays raw).
function platformPackageName(base, goos, goarch) {
  return `${base}-${goos}-${npmCpu(goarch)}`;
}

// Node platform-map key: `<node-os>-<npm-cpu>` (e.g. `win32-x64`).
function platformKey(goos, goarch) {
  return `${nodeOs(goos)}-${npmCpu(goarch)}`;
}

// Generate a single platform package's package.json object.
function platformPackage(entry, { base, version, repoUrl }) {
  return {
    name: platformPackageName(base, entry.goos, entry.goarch),
    version,
    os: [nodeOs(entry.goos)],
    cpu: [npmCpu(entry.goarch)],
    files: [entry.binary],
    license: 'MIT',
    repository: { type: 'git', url: repoUrl },
  };
}

// Build the chinmina.platforms map: Node platform-arch key -> {package, bin}.
// `package` is the windows-named platform package; `bin` is the exact binary
// filename from goreleaser (so `.exe` is data, not launcher code).
function platformsMap(entries, base) {
  const platforms = {};
  for (const entry of entries) {
    platforms[platformKey(entry.goos, entry.goarch)] = {
      package: platformPackageName(base, entry.goos, entry.goarch),
      bin: entry.binary,
    };
  }
  return platforms;
}

// Union two file lists preserving order and removing duplicates.
function unionFiles(defaults, supplied) {
  const seen = new Set();
  const out = [];
  for (const f of [...defaults, ...(Array.isArray(supplied) ? supplied : [])]) {
    if (!seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

// Derive the complete main package.json from the consumer's input.
function mainPackage(consumer, { entries, version, repoUrl, base, launcher }) {
  const launcherFile = launcher || DEFAULT_LAUNCHER;
  const commandName =
    (consumer.chinmina && consumer.chinmina.command) || unscopedName(base);

  const optionalDependencies = {};
  for (const entry of entries) {
    optionalDependencies[platformPackageName(base, entry.goos, entry.goarch)] =
      version;
  }

  const result = { ...consumer };
  // Full overrides.
  result.version = version;
  result.repository = { type: 'git', url: repoUrl };
  result.bin = { [commandName]: `./${launcherFile}` };
  result.optionalDependencies = optionalDependencies;
  // Union.
  result.files = unionFiles([launcherFile, 'README.md'], consumer.files);
  // Set-if-absent.
  if (!result.engines) {
    result.engines = { ...DEFAULT_ENGINES };
  }
  // Data-driven launcher map (replaces any consumer-supplied chinmina block).
  result.chinmina = { platforms: platformsMap(entries, base) };
  return result;
}

// Fail-fast validation of the consumer's main package.json.
function validateConsumer(pkg) {
  if (pkg === null || typeof pkg !== 'object') {
    throw new Error('main package.json is missing or not a JSON object');
  }
  if (typeof pkg.name !== 'string' || pkg.name.trim() === '') {
    throw new Error('main package.json must declare a non-empty "name"');
  }
}

// Fail-fast validation that there is something to publish.
function validateArchives(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      'no qualifying Archive entries found in artifacts.json (need type=="Archive" with at least one binary)',
    );
  }
}

module.exports = {
  NODE_OS,
  NPM_CPU,
  DEFAULT_FILES,
  DEFAULT_LAUNCHER,
  DEFAULT_ENGINES,
  nodeOs,
  npmCpu,
  unscopedName,
  discoverArchives,
  platformPackageName,
  platformKey,
  platformPackage,
  platformsMap,
  unionFiles,
  mainPackage,
  validateConsumer,
  validateArchives,
};
