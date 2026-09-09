import { rm } from 'node:fs/promises';

const generated = [
  'packages/cocos/dist',
  'packages/cocos/extensions',
  'packages/cocos/native',
  'packages/cocos/bin',
  'packages/cocos/LICENSE',
  'packages/creator2/dist',
  'packages/creator2/extension',
  'packages/creator2/native',
  'packages/creator2/installer',
  'packages/creator3/dist',
  'packages/creator3/extension',
  'packages/creator3/native',
  'packages/creator3/installer',
  'artifacts',
];

await Promise.all(generated.map((path) => rm(path, { recursive: true, force: true })));
