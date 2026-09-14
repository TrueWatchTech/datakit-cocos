import { describe, expect, it } from 'vitest';
import { Arena } from '../examples/acceptance-game/Arena';
import { StarportGame } from '../examples/acceptance-game/StarportGame';
import type { GameUI, GameNode, GameGraphics } from '../examples/acceptance-game/GameUI';

function fixture() {
  class Node implements GameNode {
    active = true; angle = 0; children: Node[] = []; x = 0; y = 0;
    constructor(public name: string, public parent?: Node) { parent?.children.push(this); }
    setPosition(x: number, y: number) { this.x = x; this.y = y; }
    setScale() {}
    destroy() { this.active = false; }
    visible(): boolean { return this.active && (!this.parent || this.parent.visible()); }
  }
  const root = new Node('Root');
  const buttons: {node: Node; click: () => void}[] = [];
  const pages: string[] = [];
  const events: {name: string; attributes: Record<string, unknown>}[] = [];
  const saved: Record<string, string> = {};
  let exits = 0;
  const color = {r: 0, g: 0, b: 0, a: 255};
  const graphics = (): GameGraphics => ({fillColor: color, strokeColor: color, lineWidth: 0,
    clear() {}, fill() {}, stroke() {}, close() {}, moveTo() {}, lineTo() {}, circle() {}, ellipse() {}, roundRect() {}});
  const node = (parent: GameNode, name: string) => new Node(name, parent as Node);
  const ui: GameUI = {
    color: (r, g, b, a = 255) => ({r, g, b, a}), node, graphics,
    box: (parent, name) => node(parent, name),
    label: (_parent, text) => ({string: text}),
    button: (parent, name, _text, _x, _y, _w, _h, click) => {
      const target = node(parent, name); buttons.push({node: target, click}); return target;
    },
    joystick() {}, resetInput() {}, hold() {}, block() {}, opacity() {}, sound() {},
    load: key => saved[key] || null, save: (key, value) => { saved[key] = value; },
  };
  const game = new StarportGame(ui, root, {
    page: name => pages.push(name), track: (name, attributes) => events.push({name, attributes}), exit: () => {exits++;},
  });
  return {game, pages, events, saved, exits: () => exits,
    click: (name: string) => {
      const button = buttons.find(button => button.node.name === name && button.node.visible());
      if (!button) throw new Error(`No visible button ${name}`);
      button.click();
    },
  };
}

describe('Shared Starport game', () => {
  it('uses identical seeded waves, movement and damage for both consumers', () => {
    const a = new Arena(1, 0); const b = new Arena(1, 0);
    for (let frame = 0; frame < 900; frame++) {
      for (const arena of [a, b]) {
        arena.move = {x: Math.sin(frame / 50), y: Math.cos(frame / 50)};
        arena.firing = true; if (frame % 180 === 0) arena.dash(); arena.tick(1 / 60);
      }
    }
    expect(a).toEqual(b); expect(a.wave).toBeGreaterThan(0); expect(a.bullets.length + a.kills).toBeGreaterThan(0);
  });
  it('freezes the battle and clears held controls during pause', () => {
    const arena = new Arena(0, 0); arena.move = {x: 1, y: 0}; arena.firing = true;
    arena.tick(.05); arena.pause(true);
    const snapshot = JSON.stringify(arena);
    for (let i = 0; i < 100; i++) arena.tick(.05);
    expect(JSON.stringify(arena)).toBe(snapshot);
    expect(arena.dash()).toBe(false); expect(arena.firing).toBe(false);
    arena.pause(false); arena.tick(.05);
    expect(arena.player).toEqual(JSON.parse(snapshot).player);
  });
  it('honors repair limits and dash cooldown', () => {
    const arena = new Arena(0, 0); expect(arena.heal()).toBe(false);
    arena.hp = 50; expect(arena.heal()).toBe(true); expect(arena.hp).toBe(85); expect(arena.heal()).toBe(false);
    expect(arena.dash()).toBe(true); expect(arena.dash()).toBe(false);
    for(let i = 0; i < 81; i++) arena.tick(.05);
    expect(arena.dash()).toBe(true);
  });
  it('runs deployment, background pause, resume, restart and exit with common event names', () => {
    const f = fixture(); f.click('Weapon'); f.click('Deploy'); f.click('SelectStage1'); f.click('StartBattle');
    f.game.keyDown(32); f.game.update(.05); f.game.background(); f.game.update(.05);
    expect(f.events.some(e => e.name === 'pause')).toBe(true);
    f.click('Resume'); f.game.update(.05);
    expect(f.events.some(e => e.name === 'resume')).toBe(true);
    f.click('Pause'); f.click('Restart');
    expect(f.pages.filter(page => page === 'Battle')).toHaveLength(2);
    f.click('Pause'); f.click('Abandon'); f.click('ExitGame');
    expect(f.exits()).toBe(1);
    expect(f.events.find(e => e.name === 'battle_start')?.attributes).toMatchObject({stage: 2, weapon: 1});
    f.game.dispose(); f.game.update(.05);
  });
  it('produces one defeat result and one reward; retry starts a fresh round', () => {
    const f = fixture(); f.click('Practice');
    for(let i = 0; i < 12000 && f.pages[f.pages.length - 1] !== 'Results'; i++) f.game.update(.05);
    expect(f.pages[f.pages.length - 1]).toBe('Results');
    const results = f.events.filter(e => e.name === 'battle_complete');
    expect(results).toHaveLength(1); expect(results[0]!.attributes.won).toBe(false);
    const saved = f.saved['starport-acceptance-v1'];
    for(let i = 0; i < 120; i++) f.game.update(.05);
    expect(f.saved['starport-acceptance-v1']).toBe(saved);
    f.click('Retry'); expect(f.pages[f.pages.length - 1]).toBe('Battle');
    expect(f.events.filter(e => e.name === 'battle_start')).toHaveLength(2);
  });
});
