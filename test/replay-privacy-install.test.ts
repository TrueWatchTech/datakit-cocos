import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('ReplayPrivacy installation', () => {
  it.each([2, 3])('installs the Creator %s script and preserves existing asset metadata', (creator) => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-privacy-install-'));
    roots.push(root);
    const pkg = join(root, 'package');
    const project = join(root, 'project');
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    mkdirSync(join(pkg, 'native'));
    mkdirSync(join(pkg, 'extensions', `creator${creator}`), { recursive: true });
    mkdirSync(join(project, 'assets'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), '{"name":"test-sdk"}');
    cpSync(resolve('installer/cli.cjs'), join(pkg, 'bin', 'cli.cjs'));
    cpSync(resolve('components'), join(pkg, 'components'), { recursive: true });
    const install = () => execFileSync(process.execPath, [
      join(pkg, 'bin', 'cli.cjs'), 'install', '--creator', String(creator), '--project', project,
    ], { encoding: 'utf8', maxBuffer: 4000 });

    expect(install()).toContain('Installed ReplayPrivacy');
    const asset = join(project, 'assets', 'truewatch-cocos-sdk', 'ReplayPrivacy.ts');
    expect(readFileSync(asset, 'utf8')).toBe(readFileSync(`components/creator${creator}/ReplayPrivacy.ts`, 'utf8'));
    const meta = '{"uuid":"existing-prefab-script-reference"}';
    writeFileSync(`${asset}.meta`, meta);
    install();
    expect(readFileSync(`${asset}.meta`, 'utf8')).toBe(meta);
  });
});
