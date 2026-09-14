import type { FTReplayPrivacyMode } from './types.js';

/** Shape of the ReplayPrivacy editor script installed in the project's assets. */
interface ReplayPrivacyComponent {
  node: unknown;
  enabledInHierarchy: boolean;
  isValid: boolean;
  readonly replayPrivacyMode: 'mask' | 'hide';
}

/** Resolve rules afresh for each capture, including newly instantiated prefabs. */
export function collectReplayPrivacyNodes(
  overrides: ReadonlyMap<unknown, FTReplayPrivacyMode>,
  components: ReplayPrivacyComponent[],
  editBoxes: { node: unknown }[],
): Map<unknown, FTReplayPrivacyMode> {
  const nodes = new Map(overrides);
  components.forEach((component) => {
    if (!component.isValid || !component.enabledInHierarchy || nodes.has(component.node)) return;
    nodes.set(component.node, component.replayPrivacyMode === 'hide' ? 'hide' : 'mask');
  });
  editBoxes.forEach((editBox) => {
    if (!nodes.has(editBox.node)) nodes.set(editBox.node, 'mask');
  });
  return nodes;
}
