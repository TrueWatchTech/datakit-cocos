import { describe, expect, it, vi } from 'vitest';
import { ReplayInputCoverage, type CoverageInput, type InputCase, type InputKind, type InputPhase, type InputPrivacy, type ReplayInputUI } from '../examples/acceptance-components/ReplayInputCoverage';

function fixture() {
  const buttons = new Map<string, () => void>();
  const rows: Array<{ id: InputCase; kind: InputKind; phase: (phase: InputPhase) => void; input: CoverageInput; value: string; visible: boolean; privacy: InputPrivacy }> = [];
  const track = vi.fn();
  const exit = vi.fn();
  const ui: ReplayInputUI = {
    input: (id, kind, _y, phase) => {
      const row = { id, kind, phase, value: '', visible: true, privacy: 'default' as InputPrivacy, input: {} as CoverageInput };
      row.input = {
        setValue: value => { row.value = value; },
        setPassword: vi.fn(),
        setVisible: visible => { row.visible = visible; },
        setPrivacy: privacy => { row.privacy = privacy; },
        blur: vi.fn(() => phase('blur')),
        destroy: vi.fn(),
      };
      rows.push(row);
      return row.input;
    },
    button: (name, _text, _x, _y, click) => { buttons.set(name, click); },
    status: vi.fn(),
    transform: vi.fn(),
  };
  const page = new ReplayInputCoverage(ui, track, exit);
  return { rows, track, exit, ui, page, click: (name: string) => buttons.get(name)!() };
}

describe('Replay input coverage workflow', () => {
  it('uses distinct real-input requests and reports phases without values', () => {
    const f = fixture();
    expect(f.rows.map(row => [row.id, row.kind])).toEqual([
      ['I01', 'normal'], ['I02', 'password'], ['I03', 'sensitive'], ['I04', 'normal'],
    ]);
    const row = f.rows[0]!;
    row.input.setValue('PRIVATE-USER-TEXT');
    for (const phase of ['focus', 'changed', 'return', 'blur'] as const) row.phase(phase);
    expect(f.track.mock.calls.slice(-4)).toEqual([
      ['I01', 'focus'], ['I01', 'changed'], ['I01', 'return'], ['I01', 'blur'],
    ]);
    expect(JSON.stringify([f.track.mock.calls, vi.mocked(f.ui.status).mock.calls])).not.toContain('PRIVATE-USER-TEXT');
    expect(JSON.stringify(f.track.mock.calls)).not.toContain('DEMO-');
  });

  it('preserves current visibility, privacy and empty-value state when recreating I04', () => {
    const f = fixture();
    const old = f.rows[3]!;
    f.click('InputVisibility');
    f.click('InputValues');
    f.click('InputPrivacy');
    f.click('InputPrivacy');
    f.click('DynamicInput');
    expect(old.input.destroy).toHaveBeenCalledOnce();
    f.click('DynamicInput');
    const replacement = f.rows[4]!;
    expect([replacement.visible, replacement.privacy, replacement.value]).toEqual([false, 'hide', '']);
    f.track.mockClear();
    old.phase('changed');
    expect(f.track).not.toHaveBeenCalled();
    replacement.phase('changed');
    expect(f.track).toHaveBeenCalledWith('I04', 'changed');
    f.click('InputPrivacy');
    expect(replacement.privacy).toBe('default');
  });

  it('exercises password display, transforms and idempotent teardown with fresh re-entry', () => {
    const f = fixture();
    f.click('PasswordVisibility');
    f.click('PasswordVisibility');
    expect(f.rows[1]!.input.setPassword).toHaveBeenNthCalledWith(1, true);
    expect(f.rows[1]!.input.setPassword).toHaveBeenNthCalledWith(2, false);
    f.click('InputTransform');
    f.click('InputTransform');
    expect(f.ui.transform).toHaveBeenNthCalledWith(1, true);
    expect(f.ui.transform).toHaveBeenNthCalledWith(2, false);
    f.click('ExitInputCoverage');
    f.page.dispose();
    expect(f.exit).toHaveBeenCalledOnce();
    f.rows.forEach(row => expect(row.input.destroy).toHaveBeenCalledOnce());
    f.track.mockClear();
    f.rows.forEach(row => row.phase('blur'));
    expect(f.track).not.toHaveBeenCalled();
    const next = fixture();
    expect(next.rows.every(row => row.visible && row.privacy === 'default' && row.value.startsWith('DEMO-'))).toBe(true);
  });
});
