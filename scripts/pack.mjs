import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

await mkdir('artifacts', { recursive: true });
const metadata = JSON.parse(await readFile('packages/cocos/package.json', 'utf8'));

const packResult = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['pack', '--workspace', metadata.name, '--pack-destination', 'artifacts', '--json'],
  {
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: process.env.npm_config_cache || '/tmp/cocos-sdk-npm-cache' },
  },
);
if (packResult.status !== 0) {
  process.stderr.write(packResult.stderr || 'npm pack failed\n');
  process.exit(packResult.status || 1);
}
const [packed] = JSON.parse(packResult.stdout);
const archive = resolve('artifacts', packed.filename);
const staging = await mkdtemp(join(tmpdir(), 'truewatch-cocos-pack-'));
const zipPath = resolve('artifacts', `truewatch-cocos-${metadata.version}.zip`);

try {
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', staging], { stdio: 'inherit' });
  if (extracted.status !== 0) throw new Error('Unable to extract the packed SDK');
  // Reuse the npm file whitelist instead of zipping the entire workspace.
  await rm(zipPath, { force: true });
  const zipped = spawnSync('zip', ['-qr', zipPath, '.'], {
    cwd: join(staging, 'package'), stdio: 'inherit',
  });
  if (zipped.status !== 0) throw new Error('Unable to create the SDK ZIP');
  console.log(`Packed ${packed.filename} and ${zipPath}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
