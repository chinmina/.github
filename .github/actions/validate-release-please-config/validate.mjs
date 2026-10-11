// Validates a release-please-config.json against release-please's published
// JSON schema, tightened so that a misspelt key anywhere fails the run.
//
// release-please itself does not validate its config: unknown keys are
// silently ignored, so a typo such as "force-tag-creaton" just turns the
// setting off. The published schema catches typos at the top level only, and
// it omits a handful of keys release-please really reads. The overlay below
// fixes both, so the schema is strict at every level without rejecting a
// valid config.
//
// release-please-config.schema.json is schemas/config.json from release-please
// v17.6.0, the version bundled by the pinned release-please-action (v5.0.0).
// Update both together.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const baseSchema = JSON.parse(
  readFileSync(new URL('./release-please-config.schema.json', import.meta.url), 'utf8'),
);

// Keys release-please v17.6.0 reads that the published schema leaves out
// (extractReleaserConfig and parseConfig in src/manifest.ts). Each applies at
// the top level (as a default) and per package.
const MISSING_KEYS = {
  component: { type: 'string' },
  'package-name': { type: 'string' },
  'include-commit-authors': { type: 'boolean' },
};

export function buildSchema(base = baseSchema) {
  const schema = structuredClone(base);
  const releaser = schema.definitions.ReleaserConfigOptions.properties;

  // Top level: already strict (additionalProperties: false), but its key list
  // is missing these.
  Object.assign(schema.properties, MISSING_KEYS, {
    'prerelease-type': releaser['prerelease-type'],
    'skip-snapshot': releaser['skip-snapshot'],
  });

  // Packages: the published schema only references ReleaserConfigOptions,
  // which allows any extra key. List every key a package may set alongside
  // additionalProperties: false so a typo inside a package fails too.
  schema.allOf[1].properties.packages.additionalProperties = {
    type: 'object',
    properties: {
      ...releaser,
      ...MISSING_KEYS,
      label: schema.properties.label,
      'release-label': schema.properties['release-label'],
    },
    additionalProperties: false,
  };
  return schema;
}

const validator = new Ajv({ allErrors: true, strict: true, validateFormats: false }).compile(
  buildSchema(),
);

// Returns a list of human-readable problems; empty when the config is valid.
export function validate(config) {
  if (validator(config)) {
    return [];
  }
  const problems = validator.errors.map((e) => {
    const where = e.instancePath || '(top level)';
    if (e.keyword === 'additionalProperties') {
      return `${where}: unknown key "${e.params.additionalProperty}"`;
    }
    return `${where}: ${e.message}`;
  });
  return [...new Set(problems)];
}

function main(path) {
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.log(`::error::release-please config is not valid JSON: ${err.message}`);
    return 1;
  }
  const problems = validate(config);
  for (const problem of problems) {
    console.log(`::error::release-please config: ${problem}`);
  }
  if (problems.length > 0) {
    console.log(
      'release-please ignores unknown keys silently, so a misspelt setting is simply off. Fix the keys above; see https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md',
    );
    return 1;
  }
  console.log('release-please config matches the release-please schema.');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv[2]);
}
