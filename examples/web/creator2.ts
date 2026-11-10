import WebPrivacyProbe from './privacy-creator2';
import { truewatchSdk } from '@truewatchtech/cocos-sdk/creator2';

const { ccclass } = cc._decorator;

/** Use with the installer's pre-engine Web bootstrap. */
@ccclass
export default class HybridTelemetrySample extends cc.Component {
  private frame = 0;
  private graphics: cc.Graphics;

  start(): void {
    const node = new cc.Node('WebTelemetryCanvas');
    this.node.addChild(node);
    this.graphics = node.addComponent(cc.Graphics);
    const privacy = node.addComponent(WebPrivacyProbe);
    privacy.enabled = false;
    truewatchSdk.start();
    truewatchSdk.rum.startView('CocosWebSample');
    truewatchSdk.mobile.bindUser({ userId: 'web-sample', userName: 'Local tester' });
    truewatchSdk.rum.addAction('web_sample_started', 'launch');
    truewatchSdk.rum.addError('Web sample error', 'Web sample stack', 'SampleError');
    truewatchSdk.logger.log('Web sample started', 'info');
    fetch('/sample-resource').catch(() => undefined);
    (window as any).__cocosWebSample = { sdk: truewatchSdk, node, ready: true, mode: 'standalone', setPrivate: (value: boolean) => { privacy.enabled = value; } };
  }
  update(): void {
    if (!this.graphics) return;
    this.frame++;
    this.graphics.clear();
    this.graphics.fillColor = cc.color(40 + this.frame % 160, 160, 210);
    this.graphics.rect(-160, -100, 320, 200);
    this.graphics.fill();
  }
  onDestroy(): void { truewatchSdk.stop(); }
}
