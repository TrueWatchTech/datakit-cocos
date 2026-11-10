import { expect, it, vi } from 'vitest';
import { AssetState, ReplayAssetCoverage } from '../examples/acceptance-components/ReplayAssetCoverage';

it('restores running effects and default privacy after mixed state changes, then ignores stale callbacks', () => {
  const commands = new Map<string, () => void>();
  const states: Readonly<AssetState>[] = [];
  const exit = vi.fn();
  const track = vi.fn();
  new ReplayAssetCoverage({ apply: state => states.push(state), status: vi.fn(),
    command: (name, _label, _x, _y, click) => commands.set(name, click),
  }, track, exit);
  const click = (name: string) => commands.get(name)!();
  ['Change', 'Running', 'Transform', 'Visibility', 'Privacy', 'Privacy'].forEach(click);
  expect(states[states.length - 1]).toEqual({ variant: 1, running: false, moved: true, visible: false, privacy: 'hide' });
  click('Inspect');
  expect(track).toHaveBeenLastCalledWith('page', 'subcontext-inspected');
  click('Reset');
  expect(states[states.length - 1]).toEqual(states[0]);
  click('Exit');
  const count = states.length;
  ['Change', 'Running', 'Reset', 'Exit'].forEach(click);
  expect(states).toHaveLength(count);
  expect(exit).toHaveBeenCalledOnce();
});
