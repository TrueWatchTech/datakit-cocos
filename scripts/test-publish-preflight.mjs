import test from 'node:test';
import assert from 'node:assert/strict';
import { planPublish } from './publish-preflight.mjs';

const name = '@truewatchtech/cocos-sdk';
const version = '0.1.0-alpha.3';
const sha = 'a'.repeat(40);
const response = (body, status = 200) => async (url) => {
  assert.equal(new URL(url).origin, 'https://registry.npmjs.org');
  assert.equal(decodeURIComponent(new URL(url).pathname), `/${name}`);
  return { status, ok: status >= 200 && status < 300, json: async () => body };
};

test('allows the first publication when npm returns 404', async () => {
  assert.deepEqual(await planPublish(version, sha, response(null, 404)), {
    npmDistTag: 'latest', alreadyPublished: false,
  });
});

test('registry permission failures and server errors do not authorize a first publication', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(planPublish(version, sha, response(null, status)), /Registry preflight failed/);
  }
});

test('registry network failures stop publication', async () => {
  await assert.rejects(planPublish(version, sha, async () => { throw new Error('offline'); }), /offline/);
});

test('rejects a malformed registry document or a different package identity', async () => {
  for (const document of [null, {}, { name: 'another-package', versions: {} },
    { name, versions: [] }, { name, versions: 'invalid' }]) {
    await assert.rejects(planPublish(version, sha, response(document)), /Invalid npm package document/);
  }
});

test('an existing version is skipped only when the package, version and commit match', async () => {
  const published = { name, version, gitHead: sha };
  assert.deepEqual(await planPublish(version, sha, response({ name, versions: { [version]: published } })), {
    npmDistTag: 'latest', alreadyPublished: true,
  });
  for (const replacement of [{ name: 'another-package' }, { version: '0.1.0' },
    { gitHead: 'b'.repeat(40) }, { gitHead: undefined }]) {
    await assert.rejects(planPublish(version, sha, response({ name, versions: {
      [version]: { ...published, ...replacement },
    } })), /different release identity/);
  }
});

test('a stable release keeps subsequent prereleases off latest', async () => {
  const plan = await planPublish('0.2.0-alpha.1', sha, response({ name, versions: { '0.1.0': {} } }));
  assert.equal(plan.npmDistTag, 'alpha');
});

test('a new publication cannot move latest to an older stable release', async () => {
  await assert.rejects(planPublish('0.1.0', sha, response({ name, versions: { '0.2.0': {} } })), /older stable release/);
});

test('missing release commit identity stops before contacting npm', async () => {
  await assert.rejects(planPublish(version, '', () => { assert.fail('unexpected registry request'); }), /commit SHA/);
});
