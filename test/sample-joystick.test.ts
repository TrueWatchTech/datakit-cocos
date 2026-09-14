import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { GameUI } from '../examples/acceptance-game/GameUI';

// Exercise the actual engine adapter event handlers with a projected camera and
// a translated/scaled joystick hierarchy. Gameplay tests alone miss this seam.
function fixture(generation: 2 | 3, zoom: number) {
  let ui!: GameUI;
  class Controller { constructor(port: GameUI) { ui = port; } }
  class Component { node = { addComponent: () => ({}) }; }
  class Vec3 { constructor(public x = 0, public y = 0, public z = 0) {} }
  const transform = { convertToNodeSpaceAR: (p: Vec3) => ({ x: (p.x + 333) / 1.2, y: (p.y + 230) / 1.2 }) };
  const handlers: Record<string, (event: unknown) => void> = {};
  const target = {
    on: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; },
    getComponent: () => transform,
    convertToNodeSpaceAR: transform.convertToNodeSpaceAR,
  };
  const events = { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' };
  const engine = {
    _decorator: { ccclass: () => (klass: unknown) => klass }, Component, Vec3,
    v2: (x: number, y: number) => ({ x, y }),
    Node: { EventType: events }, Input: { EventType: {} },
    input: { on() {} }, systemEvent: { on() {} },
    SystemEvent: { EventType: {} }, Game: { EVENT_HIDE: 'hide' }, game: { on() {} },
    profiler: { isShowingStats: () => false, hideStats() {} },
    debug: { isDisplayStats: () => false, setDisplayStats() {} },
    resources: { loadDir() {} }, loader: { loadResDir() {} },
  };
  const source = readFileSync(generation === 3
    ? 'examples/hybrid-creator3/assets/StarportScene.ts'
    : 'examples/hybrid-creator2/assets/Script/StarportScene.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
  } }).outputText;
  const exports: Record<string, new () => { initialize: (...args: unknown[]) => void }> = {};
  new Function('require', 'exports', 'cc', compiled)(
    (name: string) => name === 'cc' ? engine : { StarportGame: Controller }, exports, engine,
  );
  const adapter = new (exports[generation === 3 ? 'StarportScene' : 'default']!)();
  // Creator 3 receives physical screen pixels including the viewport offset;
  // Creator 2 event locations have already been normalized by the engine view.
  const camera = {
    screenToWorld: (p: Vec3) => new Vec3((p.x - 150) / zoom - 480, p.y / zoom - 320),
    getScreenToWorldPoint: (p: Vec3) => new Vec3(p.x / zoom - 480, p.y / zoom - 320),
  };
  adapter.initialize({ page() {}, track() {}, exit() {} }, camera);
  const moves: { x: number; y: number }[] = [];
  let releases = 0;
  ui.joystick(target as never, point => moves.push(point), () => { releases++; });
  function send(type: string, x: number, y: number, id = 1) {
    const world = { x: -333 + x * 1.2, y: -230 + y * 1.2 };
    const location = { x: (world.x + 480) * zoom + (generation === 3 ? 150 : 0), y: (world.y + 320) * zoom };
    handlers[type]!({ getID: () => id, getLocation: () => location,
      getUILocation: () => ({ x: world.x + 480, y: world.y + 320 }) });
  }
  return { moves, send, reset: () => ui.resetInput(), releases: () => releases };
}

describe.each([2, 3] as const)('Creator %i joystick camera coordinates', generation => {
  it.each([1, 1.6875, 2.25])('preserves center and all directions at zoom %s', zoom => {
    const f = fixture(generation, zoom);
    for (const [x, y] of [[0, 0], [-20, 0], [20, 0], [0, -20], [0, 20], [-20, -20]]) {
      f.send(f.moves.length ? 'move' : 'start', x!, y!);
      expect(f.moves[f.moves.length - 1]!.x).toBeCloseTo(x!);
      expect(f.moves[f.moves.length - 1]!.y).toBeCloseTo(y!);
    }
    f.send('end', 0, 0);
    expect(f.releases()).toBe(1);
  });
  it('keeps the owning finger until release/cancel and accepts input after reset', () => {
    const f = fixture(generation, 1);
    f.send('start', 0, 0, 1);
    f.send('start', 20, 20, 2); f.send('move', 20, 20, 2); f.send('end', 0, 0, 2);
    expect(f.moves).toHaveLength(1); expect(f.releases()).toBe(0);
    f.send('cancel', 0, 0, 1); expect(f.releases()).toBe(1);
    f.send('start', -20, 0, 2); expect(f.moves).toHaveLength(2);
    f.reset(); f.send('move', 20, 0, 2); expect(f.moves).toHaveLength(2);
    f.send('start', 0, 20, 3); expect(f.moves).toHaveLength(3);
  });
});
