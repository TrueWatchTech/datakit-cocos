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
  containerRoot?: unknown,
): Map<unknown, FTReplayPrivacyMode> {
  const nodes = new Map(overrides);
  components.forEach((component) => {
    if (!component.isValid || !component.enabledInHierarchy || nodes.has(component.node)) return;
    nodes.set(component.node, component.replayPrivacyMode === 'hide' ? 'hide' : 'mask');
  });
  editBoxes.forEach((editBox) => {
    if (!nodes.has(editBox.node)) nodes.set(editBox.node, 'mask');
  });
  // getComponentsInChildren includes inactive nodes in both Creator generations.
  // Keep overrides registered so reactivation restores their mode on the next frame.
  nodes.forEach((_mode, node) => {
    const state = node as { isValid?: boolean; activeInHierarchy?: boolean } | null;
    if (!state || state.isValid === false || (node !== containerRoot && state.activeInHierarchy === false)) nodes.delete(node);
  });
  return nodes;
}
