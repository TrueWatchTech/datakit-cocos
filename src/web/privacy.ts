/** Conservative Web policy: a protected component or editable field blocks the whole canvas. */
export function isScenePublic(scene: any, sceneHasComponents = true): boolean {
  if (!scene) return false;
  const nodes: any[] = sceneHasComponents ? [scene] : [...(scene.children || [])];
  while (nodes.length) {
    const node = nodes.pop();
    if (node.activeInHierarchy === false) continue;
    const privacy = node.getComponent?.('ReplayPrivacy');
    if (privacy && privacy.enabledInHierarchy !== false) return false;
    // The installed editor component exposes this marker; subclasses need not share its registered class name.
    const components = node.getComponents?.('cc.Component') || node._components || [];
    if (components.some((component: any) => component.enabledInHierarchy !== false && component.enabled !== false
      && (component.replayPrivacyMode === 'mask' || component.replayPrivacyMode === 'hide'))) return false;
    if (node.getComponent?.('cc.EditBox') || node.getComponent?.('EditBox')) return false;
    if (node.children) nodes.push(...node.children);
  }
  return true;
}
