import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseline = [0, 1, 0, 0, 1];

function releaseOrder(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta)\.(0|[1-9]\d*))?$/.exec(version);
  if (!match) throw new Error(`Unsupported release version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]),
    match[4] === 'alpha' ? 0 : match[4] === 'beta' ? 1 : 2, Number(match[5] || 0)];
}

export function validateReleaseTag(tag, packageVersion) {
  const match = /^(?:tw_)?agent_(.+)$/.exec(tag);
  if (!match) throw new Error(`Unsupported Cocos release tag: ${tag}`);
  const version = match[1];
  if (version !== packageVersion) throw new Error(`Tag ${tag} does not match package version ${packageVersion}`);
  const order = releaseOrder(version);
  const differingIndex = order.findIndex((value, index) => value !== baseline[index]);
  if (differingIndex < 0 || order[differingIndex] < baseline[differingIndex]) {
    throw new Error('TrueWatch releases must start after the 0.1.0-alpha.1 development baseline');
  }
}

export function verifyRelease(tag = process.env.RELEASE_GIT_TAG || '') {
  const root = JSON.parse(readFileSync('package.json', 'utf8'));
  const sdk = JSON.parse(readFileSync('packages/cocos/package.json', 'utf8'));
  const runtime = readFileSync('src/core/version.ts', 'utf8').match(/FT_COCOS_SDK_VERSION\s*=\s*'([^']+)'/)?.[1];
  const podspec = readFileSync('native/ios/FTCocosBridge.podspec', 'utf8').match(/s\.version\s*=\s*'([^']+)'/)?.[1];
  const replay = JSON.parse(readFileSync('packages/cocos-session-replay/package.json', 'utf8'));
  const replayRuntime = readFileSync('src/session-replay/core/version.ts', 'utf8').match(/FT_COCOS_REPLAY_VERSION\s*=\s*'([^']+)'/)?.[1];
  const replayPodspec = readFileSync('src/session-replay/native/ios/FTCocosReplayBridge.podspec', 'utf8').match(/s\.version\s*=\s*'([^']+)'/)?.[1];
  const versions = { workspace: root.version, package: sdk.version, runtime, podspec, replay: replay.version, replayRuntime, replayPodspec };
  if (replay.name !== '@truewatchtech/cocos-session-replay' || replay.peerDependencies?.[sdk.name] !== sdk.version) {
    throw new Error('Replay must declare the coordinated TrueWatch SDK peer');
  }
  if (Object.values(versions).some((version) => version !== sdk.version)) {
    throw new Error(`Cocos versions do not match: ${JSON.stringify(versions)}`);
  }
  releaseOrder(sdk.version);
  if (root.private !== true) throw new Error('The workspace root must remain private');
  if (sdk.private === true) throw new Error('The TrueWatch SDK package must be publishable');
  if (sdk.name !== '@truewatchtech/cocos-sdk') throw new Error('Unexpected TrueWatch package name');
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  if (lock.packages[''].version !== sdk.version
    || lock.packages['packages/cocos'].version !== sdk.version
    || lock.packages['packages/cocos'].name !== sdk.name
    || lock.packages['packages/cocos-session-replay']?.version !== sdk.version
    || lock.packages['packages/cocos-session-replay']?.name !== replay.name) {
    throw new Error('Workspace lockfile does not match the TrueWatch package');
  }
  if (tag) validateReleaseTag(tag, sdk.version);
  console.log(`TrueWatch Cocos ${sdk.version}: release metadata verified${tag ? ` (${tag})` : ' (no release tag)'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyRelease();
