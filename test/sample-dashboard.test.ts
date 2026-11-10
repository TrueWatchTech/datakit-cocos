import { describe, expect, it, vi } from 'vitest';
import { dashboardViewport, SampleDashboard, SAMPLE_CATEGORIES, SAMPLE_ENTRIES, statusPages } from '../examples/acceptance-components/SampleDashboard';
import type { DashboardUI, DashboardViewport } from '../examples/acceptance-components/SampleDashboard';

function layout(dashboard: SampleDashboard, viewport: DashboardViewport) {
  const targets: Array<{ id: string; x: number; y: number; width: number; height: number; click: () => void }> = [];
  const run = vi.fn();
  const refresh = vi.fn();
  const ui: DashboardUI = {
    label() {},
    button: (id, _text, x, y, width, height, click) => { targets.push({ id, x, y, width, height, click }); },
    card: (entry, x, y, width, height, click) => { targets.push({ id: entry.id, x, y, width, height, click }); },
  };
  dashboard.render(ui, viewport, refresh, run);
  return { targets, run, refresh };
}

describe('Sample dashboard navigation', () => {
  it('keeps English words intact when wrapping status details', () => {
    const text = 'Cocos page active · automatic and manual network samples ready';
    const pages = statusPages(text, 960, 640);
    expect(pages.join('')).toContain('manual');
    expect(pages.join('').replace(/\n/g, '')).toBe(text);
  });
  it('keeps the tail of long multiline status messages accessible without shrinking text', () => {
    const text = ('错误详情🙂'.repeat(20) + '\n').repeat(40) + 'END-OF-DETAIL';
    const pages = statusPages(text, 480, 800);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[pages.length - 1]).toContain('END-OF-DETAIL');
    expect(pages.join('').replace(/\n/g, '')).toBe(text.replace(/\n/g, ''));
    for (const page of pages) {
      expect(page.split('\n').length).toBeLessThanOrEqual(16);
      expect(page.split('\n').every(line => Array.from(line).length <= 17)).toBe(true);
    }
  });

  it.each([2, 3] as const)('keeps every Creator %s entry reachable through categories and pagination', generation => {
    const dashboard = new SampleDashboard(generation);
    const reached: string[] = [];
    for (const category of SAMPLE_CATEGORIES) {
      dashboard.select(category.id);
      for (let page = 0; page < dashboard.pageCount; page++) {
        const rendered = layout(dashboard, dashboardViewport(960, 640));
        for (const target of rendered.targets.filter(target => SAMPLE_ENTRIES.some(entry => entry.id === target.id))) {
          target.click();
          reached.push(target.id);
        }
        expect(rendered.run.mock.calls.map(call => call[0])).toEqual(reached.slice(-rendered.run.mock.calls.length));
        rendered.targets.find(target => target.id === 'NextPage')?.click();
      }
    }
    expect(reached.sort()).toEqual(SAMPLE_ENTRIES.filter(entry => !entry.generation || entry.generation === generation).map(entry => entry.id).sort());
    expect(new Set(reached).size).toBe(reached.length);
  });

  it('restores the category page after navigating elsewhere and clamps page boundaries', () => {
    const dashboard = new SampleDashboard(3);
    dashboard.select('components');
    dashboard.turnPage(1);
    dashboard.select('3d');
    dashboard.turnPage(100);
    expect(dashboard.page).toBe(1);
    dashboard.select('components');
    expect(dashboard.page).toBe(1);
    dashboard.turnPage(-100);
    expect(dashboard.page).toBe(0);
  });

  it.each([2, 3] as const)('uses a category picker and a single column on narrow Creator %s screens', generation => {
    const dashboard = new SampleDashboard(generation);
    const viewport = dashboardViewport(390, 844);
    const picker = layout(dashboard, viewport);
    expect(picker.targets.map(target => target.id)).toEqual(SAMPLE_CATEGORIES.map(category => `Category-${category.id}`));
    picker.targets.find(target => target.id === 'Category-components')!.click();
    const page = layout(dashboard, viewport);
    expect(page.targets.filter(target => SAMPLE_ENTRIES.some(entry => entry.id === target.id)).every(target => target.x === 0)).toBe(true);
    page.targets.find(target => target.id === 'Categories')!.click();
    expect(dashboard.showCategories).toBe(true);
  });

  it.each([2, 3] as const)('keeps Creator %s touch targets separated, inside the viewport and clear of the header/footer', generation => {
    for (const [width, height] of [[960, 640], [844, 390], [640, 640], [390, 844], [768, 1024]]) {
      const viewport = dashboardViewport(width!, height!);
      const dashboard = new SampleDashboard(generation);
      for (const category of SAMPLE_CATEGORIES) {
        dashboard.select(category.id);
        for (let page = 0; page < dashboard.pageCount; page++) {
          const { targets } = layout(dashboard, viewport);
          for (const target of targets) {
            expect(target.height, target.id).toBeGreaterThanOrEqual(56);
            expect(Math.abs(target.x) + target.width / 2, target.id).toBeLessThanOrEqual(viewport.width / 2 - 16);
            expect(target.y + target.height / 2, target.id).toBeLessThanOrEqual(viewport.height / 2 - 80);
            expect(target.y - target.height / 2, target.id).toBeGreaterThanOrEqual(-viewport.height / 2 + 88);
          }
          for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
            const a = targets[i]!; const b = targets[j]!;
            const overlap = Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;
            expect(overlap, `${a.id} overlaps ${b.id} at ${width}x${height}`).toBe(false);
          }
          dashboard.turnPage(1);
        }
      }
    }
  });
});
