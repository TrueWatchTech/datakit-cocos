import { _decorator, Component, Enum } from 'cc';

const { ccclass, property, menu, disallowMultiple } = _decorator;

export enum ReplayPrivacyMode {
  Mask = 0,
  Hide = 1,
}

/** Attach to a node or prefab to protect its bounds in Session Replay. */
@ccclass('ReplayPrivacy')
@menu('Session Replay/ReplayPrivacy')
@disallowMultiple
export default class ReplayPrivacy extends Component {
  @property({
    type: Enum(ReplayPrivacyMode),
    tooltip: 'Mask fills the Replay region gray; Hide fills it black. The live scene is unchanged.',
  })
  mode: ReplayPrivacyMode = ReplayPrivacyMode.Mask;

  /** Read by the SDK during capture; independent of SDK initialization order. */
  get replayPrivacyMode(): 'mask' | 'hide' {
    return this.mode === ReplayPrivacyMode.Hide ? 'hide' : 'mask';
  }
}
