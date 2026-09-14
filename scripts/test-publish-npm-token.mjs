import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, realpath, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planRelease, publishInOrder, validateManifests, validatePackedPackage, getRegistryDocument } from './publish-npm-token.mjs';

const baseName = '@truewatchtech/cocos-sdk';
const replayName = '@truewatchtech/cocos-session-replay';
const version = '0.1.0-alpha.6';
function manifests() {
  return [baseName, replayName].map((name, index) => ({
    name, version, publishConfig: { access: 'public' },
    repository: { url: 'git+https://github.com/TrueWatchTech/datakit-cocos.git' },
    exports: { './creator2': './dist/creator2.js', './creator3': './dist/creator3.js' },
    ...(index ? { peerDependencies: { [baseName]: version } } : {}),
  }));
}
function artifacts() {
  return [baseName, replayName].map(name => ({ name, version, integrity: `sha512-${name}` }));
}
function document(artifact) {
  return { name: artifact.name, versions: { [artifact.version]: { dist: { integrity: artifact.integrity } } },
    'dist-tags': { latest: artifact.version } };
}

test('functional pair requires coordinated versions and exact non-optional peer', () => {
  assert.equal(validateManifests({ version }, manifests()), version);
  const pair = manifests();
  pair[1].peerDependencies[baseName] = `^${version}`;
  assert.throws(() => validateManifests({ version }, pair), /exact peer/);
  pair[1].peerDependencies[baseName] = version;
  pair[1].version = '0.1.0-alpha.7';
  assert.throws(() => validateManifests({ version }, pair), /Version mismatch/);
});

test('bootstrap or reverse dependency cannot pass release preflight', () => {
  assert.throws(() => validateManifests({ version: '0.0.0-bootstrap.0' }, manifests()), /Unsupported release/);
  const pair = manifests();
  pair[0].optionalDependencies = { [replayName]: version };
  assert.throws(() => validateManifests({ version }, pair), /must not depend/);
});

test('new Replay package inherits the same policy channel as the release pair', () => {
  const base = { name: baseName, versions: { '0.1.0': {} }, 'dist-tags': { latest: '0.1.0' } };
  const result = planRelease(artifacts(), [base, null]);
  assert.deepEqual(result.map(item => item.tag), ['alpha', 'alpha']);
  assert.deepEqual(result.map(item => item.skip), [false, false]);
});

test('retry skips only identical content, and catches conflicts before publishing', () => {
  const packed = artifacts();
  assert.deepEqual(planRelease(packed, [document(packed[0]), null]).map(item => item.skip), [true, false]);
  const conflict = document(packed[1]);
  conflict.versions[version].dist.integrity = 'sha512-different';
  assert.throws(() => planRelease(packed, [null, conflict]), /different content/);
  const movedTag = document(packed[0]);
  movedTag['dist-tags'].latest = '0.1.0-alpha.7';
  assert.throws(() => planRelease(packed, [movedTag, null]), /newer version/);
});

test('a new publication cannot move an existing prerelease channel backwards', () => {
  const base = { name: baseName, versions: { '0.1.0': {}, '0.1.0-alpha.7': {} },
    'dist-tags': { latest: '0.1.0', alpha: '0.1.0-alpha.7' } };
  assert.throws(() => planRelease(artifacts(), [base, null]), /refusing to move alpha/);
});

test('base publish completes before Replay, including partial retries', async () => {
  const events = [];
  const packed = artifacts();
  await publishInOrder(packed, async item => {
    events.push(`start ${item.name}`);
    await Promise.resolve();
    events.push(`done ${item.name}`);
  });
  assert.deepEqual(events, [`start ${baseName}`, `done ${baseName}`, `start ${replayName}`, `done ${replayName}`]);
  events.length = 0;
  const plans = planRelease(packed, [document(packed[0]), null]);
  await publishInOrder(plans, async item => events.push(`publish ${item.name}`));
  assert.deepEqual(events, [`publish ${replayName}`]);
  await publishInOrder(packed.map(item => ({ ...item, skip: true })), async () => assert.fail('Already published'));
});

test('publish command failure is propagated and stops the remaining packages', async () => {
  for (const failingPackage of [baseName, replayName]) {
    const published = [];
    await assert.rejects(publishInOrder(artifacts(), async item => {
      published.push(item.name);
      if (item.name === failingPackage) throw new Error('publish failed');
    }), /publish failed/);
    assert.deepEqual(published, failingPackage === baseName ? [baseName] : [baseName, replayName]);
  }
});

test('packed exports must exist and base cannot retain Replay assets or credentials', () => {
  const manifest = manifests()[0];
  const packed = { name: baseName, version, files: [
    'dist/creator2.js', 'dist/creator3.js', 'creator2/package.json', 'creator3/package.json',
    'LICENSE', 'README.md', 'native/ios/FTCocosBridge.m',
  ].map(path => ({ path })) };
  validatePackedPackage(packed, manifest, false);
  packed.files.push({ path: 'native/shared/FTReplayFileWorker.h' });
  assert.throws(() => validatePackedPackage(packed, manifest, false), /Replay implementation/);
  packed.files.pop();
  packed.files.push({ path: '.npmrc' });
  assert.throws(() => validatePackedPackage(packed, manifest, false), /private\/configuration/);
});


test('registry reads bypass shared CDN cache on every request', async () => {
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(new URL(url));
    assert.equal(options.cache, 'no-store');
    return { ok: true, status: 200, json: async () => ({ name: baseName }) };
  };
  await getRegistryDocument(baseName, fetcher);
  await getRegistryDocument(baseName, fetcher);
  assert.equal(decodeURIComponent(urls[0].pathname), `/${baseName}`);
  assert.ok(urls[0].searchParams.get('release_check'));
  assert.notEqual(urls[0].search, urls[1].search);
});

test('CLI finishes after publish success even while registry still lacks the version', async t => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'cocos-publish-cli-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = {
    'package.json': JSON.stringify({ version }),
    'packages/cocos/package.json': JSON.stringify(manifests()[0]),
    'packages/cocos-session-replay/package.json': JSON.stringify(manifests()[1]),
    'src/core/version.ts': `export const FT_COCOS_SDK_VERSION = '${version}';`,
    'src/session-replay/core/version.ts': `export const FT_COCOS_REPLAY_VERSION = '${version}';`,
    'native/ios/FTCocosBridge.podspec': `s.version = '${version}'`,
    'src/session-replay/native/ios/FTCocosReplayBridge.podspec': `s.version = '${version}'`,
    'packages/cocos-session-replay/native-integration.json': JSON.stringify({ version, baseVersion: version }),
    'registry.mjs': `
      import { appendFileSync, existsSync, readFileSync } from 'node:fs';
      globalThis.fetch = async url => {
        const events = existsSync(process.env.TEST_EVENTS) ? readFileSync(process.env.TEST_EVENTS, 'utf8') : '';
        if (events.includes('publish ')) throw new Error('Registry queried after publishing');
        const name = decodeURIComponent(new URL(url).pathname.slice(1));
        appendFileSync(process.env.TEST_EVENTS, 'read ' + name + '\\n');
        return { status: 200, ok: true, json: async () => ({ name, versions: {}, 'dist-tags': {} }) };
      };
    `,
    'bin/npm': `#!/usr/bin/env node
      const fs = require('node:fs');
      const path = require('node:path');
      const { createHash } = require('node:crypto');
      const args = process.argv.slice(2);
      if (args[0] === 'run') process.exit(0);
      if (args[0] === 'pack') {
        const name = args[args.indexOf('--workspace') + 1];
        const replay = name.endsWith('session-replay');
        const workspace = replay ? 'cocos-session-replay' : 'cocos';
        const manifest = JSON.parse(fs.readFileSync('packages/' + workspace + '/package.json', 'utf8'));
        const destination = args[args.indexOf('--pack-destination') + 1];
        const filename = workspace + '.tgz';
        const bytes = Buffer.from(name);
        fs.writeFileSync(path.join(destination, filename), bytes);
        const files = ['dist/creator2.js', 'dist/creator3.js', 'creator2/package.json',
          'creator3/package.json', 'LICENSE', 'README.md', 'native/ios/Bridge.m'];
        if (replay) files.push('components/ReplayPrivacy.ts');
        console.log(JSON.stringify([{ name, version: manifest.version, filename,
          integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
          files: files.map(path => ({ path })) }]));
      } else if (args[0] === 'publish') {
        const name = fs.readFileSync(args[1], 'utf8');
        fs.appendFileSync(process.env.TEST_EVENTS, 'publish ' + name + '\\n');
        if (name === process.env.TEST_FAIL_PACKAGE) process.exit(42);
      } else {
        throw new Error('Unexpected npm command: ' + args[0]);
      }
    `,
  };
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { mode: name === 'bin/npm' ? 0o755 : 0o644 });
  }
  await mkdir(path.join(directory, 'scripts'));
  for (const name of ['publish-npm-token.mjs', 'release-policy.cjs']) {
    await copyFile(new URL(name, import.meta.url), path.join(directory, 'scripts', name));
  }
  const eventsFile = path.join(directory, 'events');
  const env = { ...process.env, PATH: path.join(directory, 'bin') + path.delimiter + process.env.PATH,
    TEST_EVENTS: eventsFile, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'TrueWatchTech/datakit-cocos',
    GITHUB_REF_NAME: 'agent_' + version, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-only', TEST_FAIL_PACKAGE: '' };
  const run = (mode, extra = {}) => promisify(execFile)(process.execPath,
    ['--import', path.join(directory, 'registry.mjs'), path.join(directory, 'scripts/publish-npm-token.mjs'), mode],
    { cwd: directory, env: { ...env, ...extra }, timeout: 15_000 });
  const { stdout } = await run('--ci');
  assert.match(stdout, /Both package publications completed/);
  const reads = [`read ${baseName}`, `read ${replayName}`];
  assert.deepEqual((await readFile(eventsFile, 'utf8')).trim().split('\n'),
    [...reads, `publish ${baseName}`, `publish ${replayName}`]);
  await writeFile(eventsFile, '');
  await assert.rejects(run('--ci', { TEST_FAIL_PACKAGE: baseName }), /npm publish failed/);
  assert.deepEqual((await readFile(eventsFile, 'utf8')).trim().split('\n'), [...reads, `publish ${baseName}`]);
  await writeFile(eventsFile, '');
  await run('--dry-run');
  assert.deepEqual((await readFile(eventsFile, 'utf8')).trim().split('\n'), reads);
});

test('metadata retries fetch failures and transient HTTP responses with fresh URLs', async () => {
  const urls = [];
  const waits = [];
  const result = await getRegistryDocument(baseName, async url => {
    urls.push(url);
    if (urls.length === 1) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    if (urls.length === 2) return { ok: false, status: 503 };
    return { ok: true, status: 200, json: async () => ({ name: baseName }) };
  }, { wait: async ms => waits.push(ms) });
  assert.equal(result.name, baseName);
  assert.equal(new Set(urls).size, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('metadata retries a connection failure while reading the response body', async () => {
  let reads = 0;
  await getRegistryDocument(baseName, async () => ({
    ok: true, status: 200,
    json: async () => { if (++reads === 1) throw new TypeError('terminated'); return {}; },
  }), { wait: async () => {} });
  assert.equal(reads, 2);
});

test('permanent HTTP failures and missing package metadata do not retry', async () => {
  for (const status of [401, 403, 404]) {
    let reads = 0;
    const request = getRegistryDocument(baseName, async () => { reads++; return { ok: false, status }; },
      { wait: async () => assert.fail('Permanent responses must not retry') });
    if (status === 404) assert.equal(await request, null);
    else await assert.rejects(request, new RegExp(`HTTP ${status}`));
    assert.equal(reads, 1);
  }
});
