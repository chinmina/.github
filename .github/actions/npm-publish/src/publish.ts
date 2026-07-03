#!/usr/bin/env bun
//
// Single entrypoint for the npm-publish action: parse inputs, build the release
// plan (fail-fast, before any publish), then publish each platform package and
// finally the main shim.
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
  discoverArchives,
  parseConsumer,
  parseOrThrow,
  planRelease,
  type Archive,
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

async function extractBinary(archive: Archive, dir: string): Promise<void> {
  if (archive.format === "zip") {
    await $`unzip -j ${archive.path} ${archive.binary} -d ${dir}`;
  } else {
    await $`tar -xzf ${archive.path} -C ${dir} ${archive.binary}`;
  }
  chmodSync(join(dir, archive.binary), 0o755);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(value, null, 2) + "\n");
}

async function run(work: string): Promise<void> {
  const env = parseOrThrow(EnvSchema, process.env, "missing/invalid environment");
  const base = env.PACKAGE_NAME;
  const version = env.VERSION.replace(/^v/, "");
  const repoUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`;
  const tagArgs = version.includes("-") ? ["--tag", "next"] : [];

  // --- Preflight: build the whole plan before the first publish ------------
  const consumerPath = join(env.MAIN_PACKAGE_DIR, "package.json");
  if (!existsSync(consumerPath)) throw new Error(`main package.json not found at ${consumerPath}`);
  const consumer = parseConsumer(JSON.parse(await Bun.file(consumerPath).text()));
  const archives = discoverArchives(JSON.parse(await Bun.file(env.ARTIFACTS_JSON).text()));
  const plan = planRelease(consumer, archives, { base, version, repoUrl, launcher: LAUNCHER });

  // --- Publish each platform package ---------------------------------------
  for (const { archive, manifest } of plan.platforms) {
    const dir = mkdtempSync(join(work, "plat-"));
    await extractBinary(archive, dir);
    await writeJson(join(dir, "package.json"), manifest);
    await $`npm publish --access public ${tagArgs} ${dir}`;
    console.log(`published ${manifest.name}@${version}`);
  }

  // --- Publish the main shim last ------------------------------------------
  // Its optionalDependencies reference the platform packages above. The generic
  // launcher is copied in from the action (consumers ship none).
  const mainDir = mkdtempSync(join(work, "main-"));
  cpSync(env.MAIN_PACKAGE_DIR, mainDir, { recursive: true });
  cpSync(join(env.ACTION_PATH, LAUNCHER), join(mainDir, LAUNCHER));
  if (env.README && existsSync(env.README)) cpSync(env.README, join(mainDir, "README.md"));
  await writeJson(join(mainDir, "package.json"), plan.main);
  await $`npm publish --access public ${tagArgs} ${mainDir}`;
  console.log(`published ${base}@${version}`);
}

const work = mkdtempSync(join(tmpdir(), "npm-publish-"));
try {
  await run(work);
} catch (err) {
  fail((err as Error).message);
} finally {
  rmSync(work, { recursive: true, force: true });
}
