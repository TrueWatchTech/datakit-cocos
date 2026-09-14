import { cp, mkdir, writeFile } from 'node:fs/promises';

const packageRoot = 'packages/cocos';

async function stageExtension(flavor) {
  const destination = `${packageRoot}/extensions/${flavor}`;
  await cp(`integrations/${flavor}`, destination, { recursive: true, filter: stageFilter });
  await cp('integrations/shared/install-native.cjs', `${destination}/install-native.cjs`);
  for (const file of ['install-spm.cjs', 'managed-assets.cjs', 'legacy-asset-hashes.json']) {
    await cp(`integrations/shared/${file}`, `${destination}/${file}`);
  }
}

function stageFilter(source) {
  return !source.split(/[\\/]/).some((segment) => segment === '.idea' || segment.endsWith('.iml'));
}

await mkdir(`${packageRoot}/bin`, { recursive: true });
await Promise.all([
  stageExtension('creator2'),
  stageExtension('creator3'),
  cp('native', `${packageRoot}/native`, { recursive: true, filter: stageFilter }),
  cp('installer/cli.cjs', `${packageRoot}/bin/cli.cjs`),
  cp('integrations/shared/managed-assets.cjs', `${packageRoot}/bin/managed-assets.cjs`),
  cp('integrations/shared/legacy-asset-hashes.json', `${packageRoot}/bin/legacy-asset-hashes.json`),
  cp('LICENSE', `${packageRoot}/LICENSE`),
  cp('THIRD_PARTY_NOTICES', `${packageRoot}/THIRD_PARTY_NOTICES`),
]);

await writeFile(`${packageRoot}/dist/creator3/package.json`, '{"type":"module"}\n');

const replayRoot = 'packages/cocos-session-replay';
await Promise.all([
  cp('src/session-replay/native', `${replayRoot}/native`, { recursive: true, filter: stageFilter }),
  cp('src/session-replay/components', `${replayRoot}/components`, { recursive: true, filter: stageFilter }),
  cp('LICENSE', `${replayRoot}/LICENSE`),
  cp('THIRD_PARTY_NOTICES', `${replayRoot}/THIRD_PARTY_NOTICES`),
]);
await writeFile(`${replayRoot}/dist/creator3/package.json`, '{"type":"module"}\n');
