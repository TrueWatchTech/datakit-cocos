import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function createReplayExtension(root: string, destination = join(root, 'extension')): string {
  mkdirSync(destination, { recursive: true });
  cpSync(resolve('native'), join(destination, 'native'), { recursive: true });
  cpSync(resolve('src/session-replay/native'), join(destination, 'replay-native'), { recursive: true });
  const descriptor = JSON.parse(readFileSync('packages/cocos-session-replay/native-integration.json', 'utf8'));
  writeFileSync(join(destination, 'replay-integration.json'), JSON.stringify(descriptor));
  writeFileSync(join(destination, 'sdk-integration.json'), JSON.stringify({ schemaVersion: 1, version: descriptor.baseVersion, replay: true }));
  return destination;
}
