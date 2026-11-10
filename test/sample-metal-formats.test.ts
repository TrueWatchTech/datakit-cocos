import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const cmake = process.env.CMAKE || 'cmake';
it.skipIf(spawnSync(cmake, ['--version']).status !== 0)('patches only Metal vertex conversion and reconfigures cleanly', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sample-metal-'));
  const converter = 'cocos/renderer/gfx-metal/MTLUtils.mm';
  const formats = ['RG8', 'RGB8', 'RGBA8'];
  // Pixel conversion already has UI cases. Those must not suppress the vertex fix.
  const original = `int pixels() { switch (format) { ${formats.map(f => `case Format::${f}UI: return 0;`).join('\n')} } }
MTLVertexFormat mu::toMTLVertexFormat(Format format, bool isNormalized) {
switch (format) { ${formats.map(f => `case Format::${f}: return isNormalized ? 1 : 2;`).join('\n')} }
}
Format mu::convertGFXPixelFormat(Format format) { return format; }
`;
  try {
    mkdirSync(path.dirname(path.join(root, converter)), { recursive: true });
    writeFileSync(path.join(root, converter), original);
    const helper = path.resolve('examples/hybrid-creator3/native-host/cmake/MetalVertexFormats.cmake');
    writeFileSync(path.join(root, 'CMakeLists.txt'), `cmake_minimum_required(VERSION 3.16)
project(SampleMetal LANGUAGES CXX)
set(ENGINE_NAME engine)
set(CC_USE_METAL ON)
set(COCOS_X_PATH "${root}")
add_library(engine STATIC "${converter}")
include("${helper}")
get_target_property(sources engine SOURCES)
file(WRITE "\${CMAKE_CURRENT_BINARY_DIR}/sources.txt" "\${sources}")
`);
    for (let run = 0; run < 2; run++) {
      execFileSync(cmake, ['-S', root, '-B', path.join(root, 'build')], { stdio: 'pipe', timeout: 30000 });
      const patched = readFileSync(path.join(root, 'build/sample-engine/MTLUtils.mm'), 'utf8');
      for (const format of formats) {
        expect(patched).toContain(`case Format::${format}UI:\n        case Format::${format}: return isNormalized ? 1 : 2;`);
      }
      expect(readFileSync(path.join(root, 'build/sources.txt'), 'utf8')).toBe(path.join(root, 'build/sample-engine/MTLUtils.mm'));
      expect(readFileSync(path.join(root, converter), 'utf8')).toBe(original);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
