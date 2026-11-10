import { _decorator, Component } from 'cc';
const { ccclass } = _decorator;

/** Privacy probe used by the runnable Web sample. */
@ccclass('WebReplayPrivacyProbe')
export default class WebPrivacyProbe extends Component { get replayPrivacyMode(): 'mask' { return 'mask'; } }
