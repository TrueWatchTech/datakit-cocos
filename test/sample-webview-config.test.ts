import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const targets = [2, 3].map(generation =>
  `examples/hybrid-creator${generation}/assets/resources/sample-webview.generated.json`);

afterEach(() => {
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});

function configure(url: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'cocos-webview-'));
  roots.push(root);
  const result = spawnSync(process.execPath,
    ['scripts/configure-sample-webview.mjs', '--output-root', root],
    { encoding: 'utf8', env: { ...process.env, SAMPLE_WEBVIEW_URL: url } });
  return { root, result };
}

describe('WebView sample environment configuration', () => {
  it('injects the same URL into both samples without logging it', () => {
    const url = 'http://sample.example.test:8000/verify?q="quoted"&mode=webview';
    const { root, result } = configure(` ${url} `);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(url);
    for (const target of targets) {
      expect(JSON.parse(readFileSync(path.join(root, target), 'utf8'))).toEqual({ url });
      const ignored = execFileSync('git', ['check-ignore', '--no-index', target, `${target}.meta`], { encoding: 'utf8' });
      expect(ignored.trim().split('\n')).toEqual([target, `${target}.meta`]);
    }
  });

  it.each(['', 'invalid-url', 'javascript:alert(1)', 'file:///tmp/page.html', 'https://user:password@example.test/'])
    ('rejects unsafe or missing configuration without writing files (%s)', url => {
      const { root, result } = configure(url);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Set SAMPLE_WEBVIEW_URL');
      if (url) expect(result.stdout + result.stderr).not.toContain(url);
      targets.forEach(target => expect(existsSync(path.join(root, target))).toBe(false));
    });
});
