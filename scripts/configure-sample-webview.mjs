import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output-root' || args[1].startsWith('--'))) {
  fail('Usage: configure-sample-webview.mjs [--output-root directory]');
}
const outputRoot = args.length ? resolve(args[1]) : root;
const url = process.env.SAMPLE_WEBVIEW_URL?.trim();
try {
  const parsed = new URL(url || '');
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
} catch {
  fail('Set SAMPLE_WEBVIEW_URL to an HTTP(S) URL without embedded credentials.');
}

for (const generation of [2, 3]) {
  const target = resolve(outputRoot, `examples/hybrid-creator${generation}/assets/resources/sample-webview.generated.json`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ url }, null, 2) + '\n');
}
console.log('Generated ignored WebView configuration for Creator 2 and 3.');

function fail(message) {
  console.error(`[cocos-sdk-sample] ${message}`);
  process.exit(1);
}
