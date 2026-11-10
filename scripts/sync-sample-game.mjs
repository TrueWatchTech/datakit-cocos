import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'examples/acceptance-game');
const files = ['Arena.ts', 'GameUI.ts', 'StarportGame.ts'];
const sounds = ['hit', 'shoot', 'pickup', 'victory'];
const components = ['SampleDashboard.ts', 'ReplayInputCoverage.ts', 'ReplayBasicCoverage.ts', 'ReplayScrollCoverage.ts', 'ReplayLayoutCoverage.ts', 'ReplayEffectsCoverage.ts', 'ReplayMotionCoverage.ts', 'ReplayAssetCoverage.ts'];
const check = process.argv.includes('--check');
// Stable per-project UUIDs keep editor references intact across repeated setup.
function uuid(key) {
  const hex = createHash('sha256').update(`starport:${key}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
for (const generation of [2, 3]) {
  const assets = resolve(root, `examples/hybrid-creator${generation}/assets`);
  for (const file of [...files.map(name => ['acceptance-game/' + name, name]), ...sounds.map(name => [`resources/starport-sfx/${name}.wav`, `sfx/${name}.wav`]), ...components.map(name => ['acceptance-components/' + name, '../acceptance-components/' + name]), ...['coverage.mp4', 'tone.wav'].map(name => ['resources/replay-media/' + name, '../acceptance-media/' + name])]) {
    const [relative, original] = file;
    const target = resolve(assets, relative);
    if (check) {
      if (!readFileSync(target).equals(readFileSync(resolve(source, original)))) throw new Error(`Stale sample asset: ${target}; run npm run samples:sync`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(source, original), target);
    const audio = relative.endsWith('.wav');
    const video = relative.endsWith('.mp4');
    const meta = generation === 3
      ? { ver: audio || video ? '1.0.0' : '4.0.24', importer: audio ? 'audio-clip' : video ? 'video-clip' : 'typescript', imported: true, uuid: uuid(`${generation}/${relative}`), files: audio ? ['.json', '.wav'] : video ? ['.json', '.mp4'] : [], subMetas: {}, userData: {} }
      : { ver: audio ? '2.0.3' : video ? '2.0.0' : '1.1.0', uuid: uuid(`${generation}/${relative}`), importer: audio ? 'audio-clip' : video ? 'video-clip' : 'typescript', ...(audio ? { downloadMode: 0, duration: 2 } : {}) };
    writeFileSync(`${target}.meta`, JSON.stringify(meta, null, 2) + '\n');
  }
}
console.log(check ? 'Both samples match the shared source.' : 'Shared game, input coverage and sounds installed in Creator 2 and 3 samples.');
