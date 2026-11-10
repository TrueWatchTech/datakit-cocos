import { describe, expect, it, vi } from 'vitest';
import { BasicState, ReplayBasicCoverage } from '../examples/acceptance-components/ReplayBasicCoverage';

function fixture() {
  const commands = new Map<string, () => void>();
  const states: Readonly<BasicState>[] = [];
  const track = vi.fn();
  const exit = vi.fn();
  const page = new ReplayBasicCoverage({
    apply: state => states.push(state), status: vi.fn(),
    command: (name, _label, _x, _y, click) => commands.set(name, click),
  }, track, exit);
  return { page, states, track, exit, click: (name: string) => commands.get(name)!(), current: () => states[states.length - 1]! };
}

describe('five-component Replay batch', () => {
  it('retains state through privacy, visibility and transform changes, while disabled controls ignore events', () => {
    const f = fixture();
    f.page.pressButton();
    f.page.toggle(true);
    f.click('Content');
    f.click('SpriteMode');
    f.click('SpriteMode');
    f.click('Privacy');
    f.click('Transform');
    f.click('Interaction');
    f.page.pressButton();
    f.page.toggle(false);
    f.click('Visibility');
    f.page.pressButton();
    f.click('Privacy');
    f.click('Visibility');
    expect(f.current()).toMatchObject({ clicks: 1, checked: true, updated: true, spriteMode: 2, privacy: 'hide', moved: true, visible: true, disabled: true });
    f.click('Privacy');
    f.click('Interaction');
    f.page.pressButton();
    f.page.toggle(false);
    expect(f.current()).toMatchObject({ clicks: 2, checked: false, privacy: 'default' });
    expect(f.states[0]).toMatchObject({ clicks: 0, checked: false });
  });

  it('resets all cases together and ignores callbacks after exit or disposal', () => {
    const f = fixture();
    f.page.pressButton();
    f.page.toggle(true);
    f.click('Privacy');
    f.click('Reset');
    expect(f.current()).toEqual(f.states[0]);
    f.click('Exit');
    f.track.mockClear();
    f.page.pressButton();
    f.page.toggle(true);
    f.click('Content');
    f.click('Exit');
    f.page.dispose();
    expect(f.exit).toHaveBeenCalledOnce();
    expect(f.track).not.toHaveBeenCalled();
    expect(fixture().current()).toEqual(f.states[0]);
  });
});
