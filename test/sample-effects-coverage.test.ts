import { expect, it, vi } from 'vitest';
import { EffectsState, ReplayEffectsCoverage } from '../examples/acceptance-components/ReplayEffectsCoverage';

it('restores visible, playing and unmasked state after mixed commands and stops callbacks on exit', () => {
  const commands = new Map<string, () => void>();
  const states: Readonly<EffectsState>[] = [];
  const track = vi.fn();
  const exit = vi.fn();
  new ReplayEffectsCoverage({
    apply: state => states.push(state), status: vi.fn(),
    command: (name, _label, _x, _y, click) => commands.set(name, click),
  }, track, exit);
  const click = (name: string) => commands.get(name)!();
  ['Change', 'Video', 'Web', 'Transform', 'Visibility', 'Privacy', 'Privacy'].forEach(click);
  expect(states[states.length - 1]).toEqual({ revision: 2, playing: false, moved: true, visible: false, privacy: 'hide' });
  click('Reset');
  expect(states[states.length - 1]).toEqual({ revision: 3, playing: true, moved: false, visible: true, privacy: 'default' });
  click('Exit');
  track.mockClear();
  const count = states.length;
  ['Reset', 'Web', 'Video', 'Exit'].forEach(click);
  expect(track).not.toHaveBeenCalled();
  expect(states).toHaveLength(count);
  expect(exit).toHaveBeenCalledOnce();
});
