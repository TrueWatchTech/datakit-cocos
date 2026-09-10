import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { it } from 'vitest';

it('writes owned pixel data on a bounded worker, cleans files, and recovers from I/O errors', () => {
  const root = mkdtempSync(join(tmpdir(), 'cocos-replay-worker-'));
  try {
    const binary = join(root, 'worker-test');
    execFileSync(process.env.CXX || 'c++', ['-std=c++11', '-pthread', resolve('test/native/replay-file-worker.cpp'), '-o', binary],
      { maxBuffer: 100_000, timeout: 30_000 });
    execFileSync(binary, [root], { maxBuffer: 10_000, timeout: 10_000 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 40_000);

it.skipIf(process.platform !== 'darwin')('runs iOS image jobs off the main thread with one in flight and error recovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'cocos-replay-image-'));
  try {
    const binary = join(root, 'image-test');
    execFileSync('clang', ['-fobjc-arc', '-framework', 'Foundation',
      resolve('test/native/replay-image-jobs.m'), resolve('native/ios/FTCocosReplayImageJobs.m'), '-o', binary],
    { maxBuffer: 100_000, timeout: 30_000 });
    execFileSync(binary, [], { maxBuffer: 10_000, timeout: 10_000 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 40_000);
