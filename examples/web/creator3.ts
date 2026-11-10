import WebPrivacyProbe from './privacy-creator3';
import { _decorator, Component, Node, Canvas, Camera, UITransform, Graphics, Color, Layers, director, view, ResolutionPolicy } from 'cc';
import { truewatchSdk } from '@truewatchtech/cocos-sdk/creator3';
const { ccclass } = _decorator;

/** Use with the installer's pre-engine Web bootstrap. */
@ccclass('HybridTelemetrySample')
export class HybridTelemetrySample extends Component {
  private graphics?: Graphics;
  private frame = 0;
  start(): void {
    view.setDesignResolutionSize(960, 640, ResolutionPolicy.SHOW_ALL);
    const root = new Node('WebTelemetryCanvas');
    root.layer = Layers.Enum.UI_2D;
    director.getScene()!.addChild(root);
    root.addComponent(UITransform).setContentSize(960, 640);
    const canvas = root.addComponent(Canvas);
    const cameraNode = new Node('WebCamera');
    root.addChild(cameraNode); cameraNode.setPosition(0, 0, 1000);
    const camera = cameraNode.addComponent(Camera);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.orthoHeight = 320; camera.near = 1; camera.far = 2000;
    camera.visibility = Layers.Enum.UI_2D;
    camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    camera.clearColor = new Color(12, 18, 34);
    canvas.cameraComponent = camera;
    this.graphics = root.addComponent(Graphics);
    const privacy = root.addComponent(WebPrivacyProbe);
    privacy.enabled = false;
    truewatchSdk.start();
    truewatchSdk.rum.startView('CocosWebSample');
    truewatchSdk.mobile.bindUser({ userId: 'web-sample', userName: 'Local tester' });
    truewatchSdk.rum.addAction('web_sample_started', 'launch');
    truewatchSdk.rum.addError('Web sample error', 'Web sample stack', 'SampleError');
    truewatchSdk.logger.log('Web sample started', 'info');
    fetch('/sample-resource').catch(() => undefined);
    (window as any).__cocosWebSample = { sdk: truewatchSdk, node: root, ready: true, mode: 'standalone', setPrivate: (value: boolean) => { privacy.enabled = value; } };
  }
  update(): void {
    if (!this.graphics) return;
    this.frame++;
    this.graphics.clear();
    this.graphics.fillColor = new Color(40 + this.frame % 160, 160, 210);
    this.graphics.rect(-160, -100, 320, 200);
    this.graphics.fill();
  }
  onDestroy(): void { truewatchSdk.stop(); }
}
