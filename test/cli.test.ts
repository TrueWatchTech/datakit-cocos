import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('extension installation', () => {
  it.each([2, 3])('detects other SDK copies in Creator %i without removing project files', (creator) => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-cli-'));
    try {
      const sdk = join(root, 'sdk');
      const project = join(root, 'project');
      const container = join(project, creator === 2 ? 'packages' : 'extensions');
      mkdirSync(join(project, 'assets'), { recursive: true });
      mkdirSync(join(sdk, 'bin'), { recursive: true });
      cpSync(resolve('installer/cli.cjs'), join(sdk, 'bin', 'cli.cjs'));
      writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: '@truewatchtech/cocos-sdk' }));
      mkdirSync(join(sdk, 'extensions', `creator${creator}`), { recursive: true });
      writeFileSync(join(sdk, 'extensions', `creator${creator}`, 'package.json'), '{}');
      mkdirSync(join(sdk, 'native', 'ios'), { recursive: true });
      writeFileSync(join(sdk, 'native', 'ios', 'FTCocosBridge.podspec'), '# bridge');

      const installations = [
        { directory: join(container, 'custom-sdk-copy'), bridge: join('native', 'ios', 'FTCocosBridge.podspec') },
        { directory: join(container, 'android-sdk-copy'), bridge: join('native', 'android', 'src', 'main', 'java', 'com', 'ft', 'sdk', 'cocos', 'FTCocosBridge.java') },
      ];
      const copies = installations.map(({ directory }) => directory);
      for (const { directory, bridge: relativeBridge } of installations) {
        const bridge = join(directory, relativeBridge);
        mkdirSync(join(bridge, '..'), { recursive: true });
        writeFileSync(bridge, 'project-specific bridge');
        writeFileSync(join(directory, 'custom.txt'), 'keep this');
      }
      const unrelated = join(container, 'unrelated-extension');
      mkdirSync(unrelated, { recursive: true });
      writeFileSync(join(unrelated, 'package.json'), '{}');

      for (let run = 0; run < 2; run += 1) {
        const result = spawnSync(process.execPath, [join(sdk, 'bin', 'cli.cjs'), 'install', '--project', project, '--creator', String(creator)], { encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr.match(/Another SDK extension detected/g)).toHaveLength(2);
        for (const copy of copies) {
          expect(result.stderr).toContain(copy);
          expect(readFileSync(join(copy, 'custom.txt'), 'utf8')).toBe('keep this');
        }
        expect(result.stderr).not.toContain(unrelated);
        expect(result.stderr).not.toContain(join(container, 'truewatch-cocos-sdk'));
        expect(existsSync(join(container, 'truewatch-cocos-sdk', 'native', 'ios', 'FTCocosBridge.podspec'))).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
