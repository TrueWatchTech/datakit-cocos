export type SampleCategory = 'telemetry' | 'replay' | 'components' | '3d' | 'game' | 'diagnostics';
export type DashboardTone = 'background' | 'panel' | 'primary' | 'info' | 'text' | 'muted';
export type DashboardAction = 'AutoNetwork' | 'ManualNetwork' | 'RumLog' | 'RumError'
  | 'Privacy' | 'ReplayChange' | 'InputCoverage' | 'BasicCoverage' | 'ScrollCoverage'
  | 'LayoutCoverage' | 'WebViewValidation' | 'EffectsCoverage' | 'MotionCoverage'
  | 'RenderCoverage' | 'SupportCoverage' | 'GeometryCoverage' | 'RigCoverage'
  | 'EvidenceCoverage' | 'OptionalCoverage' | 'AssetCoverage' | 'LightCoverage'
  | 'PostProcessCoverage' | 'StarportGame' | 'Replay3D' | 'VersionDiffCoverage' | 'NativeCoverage';

export interface DashboardEntry {
  id: DashboardAction;
  category: SampleCategory;
  title: string;
  description: string;
  generation?: 2 | 3;
}

export const SAMPLE_CATEGORIES: ReadonlyArray<{ id: SampleCategory; title: string }> = [
  { id: 'telemetry', title: 'Telemetry' },
  { id: 'replay', title: 'Replay & privacy' },
  { id: 'components', title: 'UI components' },
  { id: '3d', title: '3D validation' },
  { id: 'game', title: 'Game' },
  { id: 'diagnostics', title: 'Diagnostics' },
];

// Preserve node names used by automatic action collection and existing fixtures.
export const SAMPLE_ENTRIES: ReadonlyArray<DashboardEntry> = [
  { id: 'AutoNetwork', category: 'telemetry', title: 'Auto Network', description: 'Automatically track requests' },
  { id: 'ManualNetwork', category: 'telemetry', title: 'Manual Trace', description: 'Link a request to a trace' },
  { id: 'RumLog', category: 'telemetry', title: 'RUM + Log', description: 'Send an action and linked log' },
  { id: 'RumError', category: 'telemetry', title: 'RUM Error', description: 'Send an error and linked log' },
  { id: 'Privacy', category: 'replay', title: 'Privacy checks', description: 'Mask, hide, transform and fit' },
  { id: 'ReplayChange', category: 'replay', title: 'Replay change', description: 'Check colors and touch points' },
  { id: 'BasicCoverage', category: 'components', title: 'Basic controls', description: 'Labels, images and buttons' },
  { id: 'InputCoverage', category: 'components', title: 'Inputs', description: 'Input controls and interactions' },
  { id: 'ScrollCoverage', category: 'components', title: 'Scroll views', description: 'Scrolling and clipping' },
  { id: 'LayoutCoverage', category: 'components', title: 'Layout & pages', description: 'Layout and alignment' },
  { id: 'EffectsCoverage', category: 'components', title: 'Visual effects', description: 'Masks and visual effects' },
  { id: 'MotionCoverage', category: 'components', title: 'Motion', description: 'Animation and state changes' },
  { id: 'AssetCoverage', category: 'components', title: 'Tile & skeleton assets', description: 'Tile + skeleton assets' },
  { id: 'WebViewValidation', category: 'components', title: 'WebView', description: 'Web and native container' },
  { id: 'RenderCoverage', category: 'components', title: 'UI rendering', description: 'UI rendering components', generation: 3 },
  { id: 'NativeCoverage', category: '3d', title: '3D components', description: 'Meshes, lights, particles and rigs', generation: 2 },
  { id: 'Replay3D', category: '3d', title: 'Perspective scene', description: 'Motion, depth and occlusion', generation: 3 },
  { id: 'LightCoverage', category: '3d', title: 'Mesh & lights', description: '3D mesh + four lights', generation: 3 },
  { id: 'GeometryCoverage', category: '3d', title: 'Geometry', description: 'Geometry components', generation: 3 },
  { id: 'RigCoverage', category: '3d', title: 'Skinning & terrain', description: 'Skinning + terrain', generation: 3 },
  { id: 'PostProcessCoverage', category: '3d', title: 'Post effects', description: 'Post-processing validation', generation: 3 },
  { id: 'StarportGame', category: 'game', title: 'Starport Game', description: 'Lobby, combat and replay' },
  { id: 'EvidenceCoverage', category: 'diagnostics', title: 'Screenshot evidence', description: 'Screenshot evidence' },
  { id: 'VersionDiffCoverage', category: 'diagnostics', title: '2.4.x differences', description: '2.4.x differences', generation: 2 },
  { id: 'SupportCoverage', category: 'diagnostics', title: 'Feature support', description: 'Supported engine features', generation: 3 },
  { id: 'OptionalCoverage', category: 'diagnostics', title: 'Optional modules', description: 'Optional modules', generation: 3 },
];

export interface DashboardViewport { width: number; height: number; compact: boolean }

export function dashboardViewport(width: number, height: number): DashboardViewport {
  const aspect = width > 0 && height > 0 ? width / height : 1.5;
  return aspect < 1.25
    ? { width: 480, height: Math.max(800, Math.round(480 / aspect)), compact: true }
    : { width: 960, height: 640, compact: false };
}

export function statusPages(text: string, width: number, height: number): string[] {
  const columns = Math.max(1, Math.floor((width - 96) / 22));
  const linesPerPage = Math.max(1, Math.floor((height - 324) / 29));
  const lines: string[] = [];
  text.split('\n').forEach(paragraph => {
    const characters = Array.from(paragraph);
    if (!characters.length) lines.push('');
    for (let i = 0; i < characters.length;) {
      let end = Math.min(i + columns, characters.length);
      if (end < characters.length) {
        // Prefer a word boundary in English; still wrap long identifiers and CJK.
        for (let j = end - 1; j > i; j--) {
          if (/\s/.test(characters[j]!)) { end = j + 1; break; }
        }
      }
      lines.push(characters.slice(i, end).join(''));
      i = end;
    }
  });
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage).join('\n'));
  return pages.length ? pages : [''];
}

export interface DashboardUI {
  label(text: string, x: number, y: number, width: number, height: number, size: number, tone: DashboardTone): void;
  button(name: string, text: string, x: number, y: number, width: number, height: number, click: () => void, tone: DashboardTone): void;
  card(entry: DashboardEntry, x: number, y: number, width: number, height: number, click: () => void): void;
}

/** Shared navigation state survives returning from engine-specific scenes. */
export class SampleDashboard {
  category: SampleCategory = 'telemetry';
  showCategories = true;
  private pages: Partial<Record<SampleCategory, number>> = {};

  constructor(readonly generation: 2 | 3) {}

  entries(): ReadonlyArray<DashboardEntry> {
    return SAMPLE_ENTRIES.filter(entry => entry.category === this.category && (!entry.generation || entry.generation === this.generation));
  }

  get page(): number { return this.pages[this.category] || 0; }
  get pageCount(): number { return Math.ceil(this.entries().length / 4); }

  select(category: SampleCategory): void { this.category = category; this.showCategories = false; }

  turnPage(delta: number): void {
    this.pages[this.category] = Math.max(0, Math.min(this.pageCount - 1, this.page + delta));
  }

  render(ui: DashboardUI, viewport: DashboardViewport, refresh: () => void, run: (action: DashboardAction) => void): void {
    const { width, height, compact } = viewport;
    if (!compact || this.showCategories) {
      SAMPLE_CATEGORIES.forEach((category, index) => {
        ui.button(`Category-${category.id}`, category.title, compact ? 0 : -360,
          compact ? height / 2 - 166 - index * 78 : 180 - index * 68,
          compact ? width - 48 : 208, compact ? 64 : 56,
          () => { this.select(category.id); refresh(); }, this.category === category.id ? 'primary' : 'panel');
      });
      if (compact) {
        ui.label('Choose a category', 0, height / 2 - 104, width - 48, 32, 24, 'text');
        return;
      }
    }
    const contentX = compact ? 0 : 114;
    const contentWidth = compact ? width - 48 : 684;
    const title = SAMPLE_CATEGORIES.find(category => category.id === this.category)!.title;
    if (compact) {
      ui.button('Categories', '‹ Categories', -width / 2 + 100, height / 2 - 108, 152, 56,
        () => { this.showCategories = true; refresh(); }, 'panel');
    }
    ui.label(title, compact ? 80 : contentX, height / 2 - 110, compact ? width - 232 : contentWidth, 40, 28, 'text');
    const cardWidth = compact ? contentWidth : (contentWidth - 20) / 2;
    this.entries().slice(this.page * 4, this.page * 4 + 4).forEach((entry, index) => {
      ui.card(entry, compact ? 0 : contentX + (index % 2 ? 1 : -1) * (cardWidth + 20) / 2,
        compact ? height / 2 - 208 - index * 124 : 92 - Math.floor(index / 2) * 152,
        cardWidth, compact ? 108 : 132, () => run(entry.id));
    });
    const pagerY = -height / 2 + 126;
    const pagerOffset = compact ? (contentWidth - 144) / 2 : 220;
    const pagerWidth = compact ? 144 : 168;
    if (this.pageCount > 1) {
      if (this.page > 0) ui.button('PreviousPage', 'Previous', contentX - pagerOffset, pagerY, pagerWidth, 56,
        () => { this.turnPage(-1); refresh(); }, 'panel');
      ui.label(`${this.page + 1} / ${this.pageCount}`, contentX, pagerY, 112, 48, 20, 'muted');
      if (this.page + 1 < this.pageCount) ui.button('NextPage', 'Next', contentX + pagerOffset, pagerY, pagerWidth, 56,
        () => { this.turnPage(1); refresh(); }, 'panel');
    } else if (this.category === '3d' && this.generation === 2) {
      ui.label('Perspective meshes, lighting, particles and animated 3D rigs.', contentX, pagerY, contentWidth, 54, 18, 'muted');
    }
  }
}
