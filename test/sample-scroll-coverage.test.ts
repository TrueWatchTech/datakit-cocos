import { describe, expect, it, vi } from 'vitest';
import { ReplayScrollCoverage, ScrollState } from '../examples/acceptance-components/ReplayScrollCoverage';

function fixture() {
  const commands = new Map<string, () => void>();
  const states: Readonly<ScrollState>[] = [];
  const track = vi.fn();
  const exit = vi.fn();
  const page = new ReplayScrollCoverage({
    apply: state => states.push(state), status: vi.fn(),
    command: (name, _label, _x, _y, click) => commands.set(name, click),
  }, track, exit);
  return { page, states, track, exit, click: (name: string) => commands.get(name)!(), current: () => states[states.length - 1]! };
}

describe('scrolling and clipping Replay batch', () => {
  it('preserves native scroll position across slider and privacy changes', () => {
    const f = fixture();
    f.click('Scroll');
    const revision = f.current().scrollRevision;
    f.page.slide(0.72);
    f.click('Privacy');
    f.click('MaskShape');
    f.click('Transform');
    expect(f.current()).toMatchObject({ progress: 0.72, bottom: true, scrollRevision: revision, ellipse: true, moved: true, privacy: 'mask' });
    const count = f.states.length;
    f.page.scrolled();
    expect(f.states).toHaveLength(count);
    expect(f.track).toHaveBeenLastCalledWith('ScrollView', 'dragged');
    f.click('Reset');
    expect(f.current()).toEqual({ ...f.states[0], scrollRevision: revision + 1 });
  });

  it('clamps progress and rejects non-finite, hidden and disposed callbacks', () => {
    const f = fixture();
    f.page.slide(-0.1);
    expect(f.current().progress).toBe(0);
    f.page.slide(1.1);
    expect(f.current().progress).toBe(1);
    f.page.slide(NaN);
    f.page.slide(Infinity);
    expect(f.current().progress).toBe(1);
    f.click('Visibility');
    f.track.mockClear();
    f.page.slide(0.5);
    f.page.scrolled();
    expect(f.track).not.toHaveBeenCalled();
    f.click('Visibility');
    f.click('Exit');
    f.track.mockClear();
    f.page.slide(0.1);
    f.page.scrolled();
    f.click('Reset');
    f.click('Exit');
    expect(f.exit).toHaveBeenCalledOnce();
    expect(f.track).not.toHaveBeenCalled();
  });
});
