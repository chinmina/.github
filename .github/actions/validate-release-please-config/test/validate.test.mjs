import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../validate.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const base = () => ({
  'release-type': 'simple',
  draft: true,
  'force-tag-creation': true,
  'include-component-in-tag': false,
  packages: { '.': {} },
});

for (const name of ['dollop.json', 'kms-import.json', 'relic-example.json']) {
  test(`real consumer config is valid: ${name}`, () => {
    assert.deepEqual(validate(fixture(name)), []);
  });
}

test('keys the published schema omits are accepted at both levels', () => {
  const config = {
    ...base(),
    component: 'x',
    'package-name': 'x',
    'include-commit-authors': true,
    'prerelease-type': 'rc',
    'skip-snapshot': true,
    packages: {
      '.': { component: 'x', 'package-name': 'x', label: 'a', 'release-label': 'b', draft: true },
    },
  };
  assert.deepEqual(validate(config), []);
});

test('top-level typo is rejected', () => {
  assert.deepEqual(validate({ ...base(), 'force-tag-creaton': true }), [
    '(top level): unknown key "force-tag-creaton"',
  ]);
});

test('package-level typo is rejected', () => {
  const config = { ...base(), packages: { '.': { 'force-tag-creaton': true } } };
  assert.deepEqual(validate(config), ['/packages/.: unknown key "force-tag-creaton"']);
});

test('wrong type is rejected', () => {
  assert.deepEqual(validate({ ...base(), draft: 'true' }), ['/draft: must be boolean']);
});

test('missing packages is rejected', () => {
  const { packages, ...config } = base();
  assert.deepEqual(validate(config), ["(top level): must have required property 'packages'"]);
});
