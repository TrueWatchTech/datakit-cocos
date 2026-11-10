const { ccclass } = cc._decorator;

/** Privacy probe used by the runnable Web sample. */
@ccclass('WebReplayPrivacyProbe')
export default class WebPrivacyProbe extends cc.Component { get replayPrivacyMode(): 'mask' { return 'mask'; } }
