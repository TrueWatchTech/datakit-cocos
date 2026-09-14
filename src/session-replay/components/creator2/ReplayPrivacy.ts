const { ccclass, property, menu, disallowMultiple } = cc._decorator;

export enum ReplayPrivacyMode {
  Mask = 0,
  Hide = 1,
}

/** Attach to a node or prefab to protect its bounds in Session Replay. */
@ccclass('ReplayPrivacy')
@menu('Session Replay/ReplayPrivacy')
@disallowMultiple
export default class ReplayPrivacy extends cc.Component {
  @property({
    type: cc.Enum(ReplayPrivacyMode),
    tooltip: 'Mask fills the Replay region gray; Hide fills it black. The live scene is unchanged.',
  })
  mode: ReplayPrivacyMode = ReplayPrivacyMode.Mask;

  /** Read by the SDK during capture; independent of SDK initialization order. */
  get replayPrivacyMode(): 'mask' | 'hide' {
    return this.mode === ReplayPrivacyMode.Hide ? 'hide' : 'mask';
  }
}
