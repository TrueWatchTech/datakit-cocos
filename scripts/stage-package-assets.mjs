import { cp, mkdir, writeFile } from 'node:fs/promises';

const packageRoot = 'packages/cocos';

async function stageExtension(flavor) {
  const destination = `${packageRoot}/extensions/${flavor}`;
  await cp(`integrations/${flavor}`, destination, { recursive: true, filter: stageFilter });
  await cp('integrations/shared/install-native.cjs', `${destination}/install-native.cjs`);
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
  cp('LICENSE', `${packageRoot}/LICENSE`),
  cp('THIRD_PARTY_NOTICES', `${packageRoot}/THIRD_PARTY_NOTICES`),
]);

await writeFile(`${packageRoot}/dist/creator3/package.json`, '{"type":"module"}\n');
