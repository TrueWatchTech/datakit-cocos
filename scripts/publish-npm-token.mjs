#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { selectDistTag } = require('./release-policy.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'https://registry.npmjs.org';
const packages = [
  { name: '@truewatchtech/cocos-sdk', directory: 'packages/cocos' },
  { name: '@truewatchtech/cocos-session-replay', directory: 'packages/cocos-session-replay' },
];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateManifests(workspace, manifests) {
  check(manifests.length === 2, 'Both functional packages are required.');
  const version = workspace.version;
  selectDistTag(version, []); // Reject bootstrap and unsupported release versions.
  for (const [index, manifest] of manifests.entries()) {
    check(manifest.name === packages[index].name, `Expected package ${packages[index].name}.`);
    check(manifest.version === version, `Version mismatch: ${manifest.name} must be ${version}.`);
    check(!manifest.private, `${manifest.name} is private.`);
    check(manifest.publishConfig?.access === 'public', `${manifest.name} must declare public access.`);
    check(!manifest.publishConfig?.registry || manifest.publishConfig.registry.replace(/\/$/, '') === registry,
      `${manifest.name} must publish to npmjs.org.`);
    check(manifest.repository?.url === 'git+https://github.com/TrueWatchTech/datakit-cocos.git',
      `${manifest.name} must identify TrueWatchTech/datakit-cocos as its repository.`);
    for (const engine of ['creator2', 'creator3']) {
      check(manifest.exports?.[`./${engine}`], `${manifest.name} is missing its functional ${engine} entry.`);
    }
  }
  const [base, replay] = manifests;
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    check(!base[field]?.[replay.name], `The base package must not depend on Replay (${field}).`);
  }
  check(replay.peerDependencies?.[base.name] === version,
    `Replay must require ${base.name}@${version} as an exact peer dependency.`);
  check(!replay.peerDependenciesMeta?.[base.name]?.optional, 'The base peer dependency must be required.');
  return version;
}

async function localPreflight() {
  const workspace = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifests = [];
  for (const item of packages) {
    try {
      manifests.push(JSON.parse(await readFile(path.join(root, item.directory, 'package.json'), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Functional package is missing: ${item.directory}/package.json. Complete the Replay split first; the bootstrap package will not be published.`);
    }
  }
  const version = validateManifests(workspace, manifests);
  const runtime = await readFile(path.join(root, 'src/core/version.ts'), 'utf8');
  check(runtime.match(/FT_COCOS_SDK_VERSION\s*=\s*'([^']+)'/)?.[1] === version,
    'Base SDK runtime version does not match the package versions.');
  for (const [file, pattern] of [
    ['src/session-replay/core/version.ts', /FT_COCOS_REPLAY_VERSION\s*=\s*'([^']+)'/],
    ['native/ios/FTCocosBridge.podspec', /s\.version\s*=\s*'([^']+)'/],
    ['src/session-replay/native/ios/FTCocosReplayBridge.podspec', /s\.version\s*=\s*'([^']+)'/],
  ]) {
    check((await readFile(path.join(root, file), 'utf8')).match(pattern)?.[1] === version,
      `${file} version does not match the package versions.`);
  }
  const integration = JSON.parse(await readFile(path.join(root, 'packages/cocos-session-replay/native-integration.json'), 'utf8'));
  check(integration.version === version && integration.baseVersion === version,
    'Replay native integration versions do not match the package versions.');
  return { version, manifests };
}

function exportTargets(value) {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(exportTargets) : [];
}

export function validatePackedPackage(packed, manifest, replay) {
  check(packed.name === manifest.name && packed.version === manifest.version, 'Packed identity mismatch.');
  const files = new Set(packed.files.map(file => file.path));
  for (const target of exportTargets(manifest.exports)) {
    check(target.startsWith('./') && files.has(target.slice(2)), `Missing packed export: ${manifest.name} ${target}`);
  }
  for (const engine of ['creator2', 'creator3']) {
    check(files.has(`${engine}/package.json`), `Missing legacy ${engine} package resolution metadata.`);
  }
  check(files.has('LICENSE') && files.has('README.md'), 'Packed license or README is missing.');
  for (const file of files) {
    check(!/(^|\/)(?:\.npmrc|\.env(?:\..*)?|docs|node_modules)(?:\/|$)/.test(file),
      `Unexpected private/configuration file in package: ${file}`);
    if (!replay) check(!/(?:^|\/)(?:[^/]*replay[^/]*|capture\.(?:js|d\.ts)(?:\.map)?)$/i.test(file),
      `Replay implementation remains in the base tarball: ${file}`);
  }
  check([...files].some(file => file.startsWith('native/') && /\.(?:java|m|h)$/.test(file)),
    `${manifest.name} has no native bridge assets.`);
  if (replay) check([...files].some(file => file.startsWith('components/') && file.includes('ReplayPrivacy')),
    'ReplayPrivacy is missing from the Replay package.');
}

export function planRelease(artifacts, documents) {
  const version = artifacts[0].version;
  const history = documents.flatMap(document => Object.keys(document?.versions || {}));
  const tag = selectDistTag(version, history);
  return artifacts.map((artifact, index) => {
    const document = documents[index];
    if (document) check(document.name === artifact.name && document.versions, 'Invalid registry package document.');
    const currentTag = document?.['dist-tags']?.[tag];
    if (currentTag && currentTag !== version) {
      // The existing policy permits stable latest to replace a higher prerelease.
      const stableReplacingPrerelease = tag === 'latest' && !version.includes('-') && currentTag.includes('-');
      check(stableReplacingPrerelease || compareVersions(currentTag, version) <= 0,
        `${artifact.name}: refusing to move ${tag} from newer version ${currentTag} to ${version}.`);
    }
    const existing = document?.versions[version];
    if (existing) {
      check(existing.dist?.integrity === artifact.integrity,
        `${artifact.name}@${version} already exists with different content. Use a new coordinated version; npm versions cannot be overwritten.`);
      check(document['dist-tags']?.[tag] === version,
        `${artifact.name}@${version} exists but ${tag} points elsewhere. Inspect the release state before publishing; this script will not move existing tags.`);
    }
    return { ...artifact, tag, skip: Boolean(existing) };
  });
}

export async function publishInOrder(plans, publish) {
  for (const plan of plans) {
    if (!plan.skip) await publish(plan);
  }
}

function transientReadError(error) {
  return [408, 425, 429].includes(error.status) || error.status >= 500
    || ['TimeoutError', 'AbortError'].includes(error.name)
    || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH',
      'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']
      .includes(error.cause?.code || error.code)
    || (error instanceof TypeError && ['fetch failed', 'terminated'].includes(error.message));
}

async function retryRegistryRead(operation, label, {
  attempts = 3, delay = 1_000,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!transientReadError(error) || attempt >= attempts) {
        const code = error.cause?.code || error.code;
        throw new Error(`${label} failed after ${attempt} attempt(s): ${error.message}${code ? ` (${code})` : ''}`, { cause: error });
      }
      await wait(delay * attempt);
    }
  }
}

function checkRegistryResponse(response) {
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
}

export async function getRegistryDocument(name, fetcher = fetch, retryOptions) {
  return retryRegistryRead(async () => {
    // A fresh URL also bypasses shared CDN cache on each retry.
    const response = await fetcher(`${registry}/${encodeURIComponent(name)}?release_check=${randomUUID()}`, {
      cache: 'no-store', signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return null;
    checkRegistryResponse(response);
    return await response.json();
  }, `Registry metadata read for ${name}`, retryOptions);
}

function compareVersions(left, right) {
  function parts(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/.exec(version);
    check(match, `Cannot compare existing dist-tag version ${version}; inspect its release policy first.`);
    return [Number(match[1]), Number(match[2]), Number(match[3]),
      match[4] === 'alpha' ? 0 : match[4] === 'beta' ? 1 : 2, Number(match[5] || 0)];
  }
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function main(mode) {
  check(['--check', '--dry-run', '--publish', '--ci'].includes(mode), 'Use --check, --dry-run, --publish, or --ci.');
  const before = await localPreflight();
  console.log(`Local package preflight passed: both packages at ${before.version}.`);
  if (mode === '--check') return;
  if (mode === '--ci') {
    check(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === 'TrueWatchTech/datakit-cocos',
      '--ci is reserved for the TrueWatchTech/datakit-cocos GitHub Actions workflow.');
    check(process.env.GITHUB_REF_NAME === `agent_${before.version}`, 'Git tag does not match the coordinated package version.');
    check(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      'GitHub Actions requires id-token: write for npm Trusted Publishing.');
  }
  const token = process.env.REPLAY_NPM_TOKEN;
  if (mode === '--publish') check(token, 'Set REPLAY_NPM_TOKEN or use publish-npm-token.zsh to enter a token.');
  const cleanEnv = { ...process.env };
  for (const name of ['REPLAY_NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN']) delete cleanEnv[name];
  const scratch = await mkdtemp(path.join(tmpdir(), 'cocos-npm-release-'));
  const config = path.join(scratch, 'npmrc');
  const redact = value => token ? value.split(token).join('[REDACTED]') : value;

  async function command(args, { cwd = root, authenticated = false } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
        cwd,
        env: {
          ...cleanEnv,
          npm_config_cache: path.join(scratch, 'cache'),
          NPM_CONFIG_CACHE: path.join(scratch, 'cache'),
          ...(authenticated ? { NPM_CONFIG_USERCONFIG: config, ...(mode === '--publish' ? { REPLAY_NPM_TOKEN: token } : {}) } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let errors = '';
      child.stdout.on('data', chunk => { output = (output + chunk).slice(-256_000); });
      child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8_000); });
      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) reject(new Error(redact(`npm ${args[0]} failed (${code}):\n${output.slice(-4000)}\n${errors}`)));
        else resolve(output);
      });
    });
  }

  try {
    if (mode === '--ci') await writeFile(config, 'registry=https://registry.npmjs.org/\n', { mode: 0o600 });
    if (mode === '--publish') {
      await writeFile(config, 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${REPLAY_NPM_TOKEN}\n', { mode: 0o600 });
      const identity = await command(['whoami', '--registry', registry, '--fetch-retries=0', '--fetch-timeout=30000'],
        { cwd: scratch, authenticated: true });
      console.log(`npm identity: ${identity.trim()}`);
    }
    for (const script of ['typecheck', 'test', 'test:release-policy', 'test:publish-token', 'build', 'test:packed']) {
      console.log(`Running npm run ${script}...`);
      await command(['run', script]);
    }
    const after = await localPreflight();
    assert.deepEqual(after, before, 'Release manifests changed while building.');
    const destination = path.join(root, 'artifacts', 'npm-token-release', before.version);
    await mkdir(destination, { recursive: true });
    const artifacts = [];
    for (const [index, item] of packages.entries()) {
      const output = await command(['pack', '--workspace', item.name, '--pack-destination', destination, '--ignore-scripts', '--json']);
      const packed = JSON.parse(output)[0];
      validatePackedPackage(packed, before.manifests[index], index === 1);
      check(path.basename(packed.filename) === packed.filename, 'Unexpected packed filename.');
      const tarball = path.join(destination, packed.filename);
      const bytes = await readFile(tarball);
      const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
      check(packed.integrity === integrity, 'Packed integrity mismatch.');
      artifacts.push({ name: item.name, version: before.version, tarball, integrity });
    }
    // Check both registry identities before the first irreversible publication.
    const documents = [];
    for (const artifact of artifacts) documents.push(await getRegistryDocument(artifact.name));
    check(documents[0], 'The existing base package was not found on the public registry. Check the registry before publishing.');
    const plans = planRelease(artifacts, documents);
    await writeFile(path.join(destination, 'release-plan.json'), `${JSON.stringify(plans, null, 2)}\n`);
    for (const plan of plans) console.log(`${plan.skip ? 'Already published' : 'Ready'}: ${plan.name}@${plan.version}, tag=${plan.tag}, ${plan.tarball}`);
    if (mode === '--dry-run') {
      console.log('Dry run complete. No package or tag was published.');
      return;
    }
    await publishInOrder(plans, async plan => {
      console.log(`Publishing ${plan.name}@${plan.version}...`);
      // Publish the exact inspected tarball outside repository npm configuration.
      await command(['publish', plan.tarball, '--registry', registry, '--access', 'public', '--tag', plan.tag,
        '--ignore-scripts', '--workspaces=false', '--fetch-retries=0', '--fetch-timeout=60000'],
      { cwd: scratch, authenticated: true });
      console.log(`Published ${plan.name}@${plan.version} (${plan.tag}).`);
    });
    console.log('Both package publications completed. Registry visibility is not checked after publishing.');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] || '--dry-run').catch(error => {
    const token = process.env.REPLAY_NPM_TOKEN;
    console.error(token ? error.message.split(token).join('[REDACTED]') : error.message);
    process.exitCode = 1;
  });
}
