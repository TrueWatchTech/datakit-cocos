import { describe, expect, it, vi } from 'vitest';
import { LayoutState, ReplayLayoutCoverage } from '../examples/acceptance-components/ReplayLayoutCoverage';

function fixture() {
  const commands = new Map<string, () => void>();
  const states: Readonly<LayoutState>[] = [];
  const track = vi.fn();
  const exit = vi.fn();
  const page = new ReplayLayoutCoverage({
    apply: state => states.push(state), status: vi.fn(),
    command: (name, _text, _x, _y, click) => commands.set(name, click),
  }, track, exit);
  return { page, states, track, exit, click: (name: string) => commands.get(name)!(), current: () => states[states.length - 1]! };
}

describe('pages and layout Replay batch', () => {
  it('preserves engine-owned gesture and selection changes while unrelated commands update', () => {
    const f = fixture();
    f.page.turned(1);
    f.page.selected(2);
    f.click('Layout');
    f.click('Layout');
    f.click('Widget');
    f.click('Widget');
    f.click('Widget');
    f.click('Privacy');
    f.click('Transform');
    expect(f.current()).toMatchObject({ page: 1, selected: 2, pageRevision: 0, selectionRevision: 0, layout: 2, alignment: 3, privacy: 'mask', moved: true });
    f.click('Page');
    expect(f.current()).toMatchObject({ page: 2, pageRevision: 1 });
    f.click('Page');
    expect(f.current()).toMatchObject({ page: 0, pageRevision: 2 });
    f.click('Reset');
    expect(f.current()).toEqual({ ...f.states[0], pageRevision: 3, selectionRevision: 3 });
  });

  it('rejects invalid, hidden, duplicate and disposed engine events', () => {
    const f = fixture();
    f.track.mockClear();
    [NaN, Infinity, -1, 3, 0.5, 0].forEach(value => { f.page.turned(value); f.page.selected(value); });
    expect(f.track).not.toHaveBeenCalled();
    f.click('Visibility');
    f.track.mockClear();
    f.page.turned(1);
    f.page.selected(1);
    expect(f.track).not.toHaveBeenCalled();
    f.click('Visibility');
    f.click('Exit');
    f.track.mockClear();
    f.page.turned(2);
    f.page.selected(2);
    f.click('Reset');
    f.click('Exit');
    expect(f.track).not.toHaveBeenCalled();
    expect(f.exit).toHaveBeenCalledOnce();
  });
});
