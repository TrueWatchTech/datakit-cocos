import {
  _decorator,
  Button,
  Camera,
  Canvas,
  Color,
  Component,
  Graphics,
  Label,
  Layers,
  Node,
  ResolutionPolicy,
  Scene,
  UITransform,
  director,
  native,
  sys,
  view,
} from 'cc';
import { truewatchSdk, setReplayCamera } from '@truewatchtech/cocos-sdk/creator3';

const { ccclass } = _decorator;

const VIEW_NAME = 'CocosHybridCreator3Sample';
const AUTO_TEST_URL = 'https://httpbin.org/get?sample=cocos-hybrid-creator3&collection=automatic';
const TRACE_TEST_URL = 'https://httpbin.org/get?sample=cocos-hybrid-creator3&collection=manual';
const ATTRIBUTES = {
  sample_name: 'cocos-hybrid-creator3',
  creator_generation: '3',
  integration_mode: 'hybrid',
};

const COLORS = {
  background: new Color(12, 18, 34, 255),
  panel: new Color(27, 39, 64, 255),
  primary: new Color(44, 202, 178, 255),
  info: new Color(73, 142, 245, 255),
  warning: new Color(245, 166, 35, 255),
  danger: new Color(236, 83, 103, 255),
  text: new Color(239, 244, 255, 255),
  muted: new Color(151, 164, 190, 255),
};

let activeSample: HybridTelemetryRuntime | undefined;

/** Startup component for the Creator 3 Hybrid integration sample. */
@ccclass('HybridTelemetrySample')
export class HybridTelemetrySample extends Component {
  start(): void {
    if (activeSample) return;
    activeSample = new HybridTelemetryRuntime();
    activeSample.start();
  }
}

/** Call this only when the native host removes or leaves the Cocos container. */
export function leaveHybridCocos(): void {
  if (activeSample) activeSample.leaveCocosPage();
  else truewatchSdk.leaveCocos();
}

interface UntrackedXhrMethods {
  open: (this: XMLHttpRequest, method: string, url: string, async?: boolean) => void;
  send: (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;
  setRequestHeader: (this: XMLHttpRequest, name: string, value: string) => void;
}

class HybridTelemetryRuntime {
  private status?: Label;
  private replayCard?: Graphics;
  private privacyMaskProbe?: Node;
  private replayState = 0;
  private maskShowAll = false;
  private resourceSequence = 0;
  private entered = false;
  private waitingForNativeReturn = false;
  private untrackedXhr?: UntrackedXhrMethods;

  start(): void {
    const { root, camera } = this.createScene();
    setReplayCamera(camera);
    this.render(root);

    if (!sys.isNative) {
      this.setStatus('Editor preview only. Build Android or iOS to call the native bridge.', COLORS.warning);
      return;
    }

    try {
      this.untrackedXhr = {
        open: XMLHttpRequest.prototype.open as UntrackedXhrMethods['open'],
        send: XMLHttpRequest.prototype.send,
        setRequestHeader: XMLHttpRequest.prototype.setRequestHeader,
      };
      truewatchSdk.attach({
        replay: {
          captureFps: 2,
          maxImageDimension: 720,
          touchPrivacy: 'show',
        },
        autoTrack: {
          scenes: false,
          actions: true,
          errors: true,
          console: true,
          network: true,
        },
      });
      if (this.privacyMaskProbe) truewatchSdk.replay.setPrivacy(this.privacyMaskProbe, 'mask');
      if (this.isNativePageVisible()) {
        this.setStatus('Hybrid attached · waiting for the native page to open Cocos', COLORS.info);
        this.waitForNativeReturn();
      } else {
        this.enterCocosPage();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`Native initialization missing: ${message}`, COLORS.danger);
      console.error('[HybridTelemetrySample] Unable to enter Hybrid mode', error);
    }
  }

  private enterCocosPage(): void {
    if (this.entered) return;
    truewatchSdk.enterCocos({ viewName: VIEW_NAME });
    this.entered = true;
    truewatchSdk.rum.addAction('hybrid_sample_entered_cocos', 'launch', ATTRIBUTES);
    truewatchSdk.logger.log('Creator 3 Hybrid sample entered Cocos', 'info', ATTRIBUTES);
    this.setStatus('Cocos page active · automatic and manual network samples ready', COLORS.primary);
  }

  leaveCocosPage(): void {
    if (!this.entered) return;
    truewatchSdk.leaveCocos();
    this.entered = false;
  }

  private emitRumAndLog(): void {
    const attributes = { ...ATTRIBUTES, button: 'rum_log', emitted_at: Date.now() };
    truewatchSdk.rum.addAction('creator3_rum_log_clicked', 'click', attributes);
    truewatchSdk.logger.log('Creator 3 sample emitted a RUM Action and linked Log', 'info', attributes);
    this.setStatus('RUM Action + linked Log emitted', COLORS.primary);
  }

  private emitAutomaticResource(): void {
    const url = `${AUTO_TEST_URL}&request_id=${Date.now().toString(36)}-${++this.resourceSequence}`;
    const attributes = { ...ATTRIBUTES, collection_mode: 'automatic', request_url: url };
    const request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.timeout = 12_000;
    this.setStatus('Automatic XHR in progress · SDK owns Resource and Trace', COLORS.info);
    request.onload = () => {
      const failed = request.status < 200 || request.status >= 400;
      truewatchSdk.logger.log(
        `Creator 3 automatic network completed with status ${request.status}`,
        failed ? 'warning' : 'info',
        attributes,
      );
      this.setStatus(
        failed ? `Automatic Resource failed (${request.status})` : `Automatic Resource + Trace reported (${request.status})`,
        failed ? COLORS.warning : COLORS.primary,
      );
    };
    request.onerror = () => this.setStatus('Automatic Resource failed (network error)', COLORS.warning);
    request.ontimeout = () => this.setStatus('Automatic Resource failed (timeout)', COLORS.warning);
    request.send();
  }

  private emitManualTraceResource(): void {
    const methods = this.untrackedXhr;
    if (!methods) {
      this.setStatus('Original XHR methods are unavailable for the manual sample', COLORS.danger);
      return;
    }
    const resourceKey = `creator3-manual-trace-${Date.now().toString(36)}-${++this.resourceSequence}`;
    const startedAt = nowNs();
    const traceHeaders = truewatchSdk.trace.getHeaders(TRACE_TEST_URL, resourceKey);
    const attributes = {
      ...ATTRIBUTES,
      collection_mode: 'manual',
      resource_key: resourceKey,
      trace_link_rum: true,
    };

    truewatchSdk.rum.startResource(resourceKey, attributes);
    truewatchSdk.rum.addAction('creator3_trace_request_started', 'network', attributes);
    this.setStatus('Trace headers generated; request in progress…', COLORS.info);

    const request = new XMLHttpRequest();
    methods.open.call(request, 'GET', TRACE_TEST_URL, true);
    Object.keys(traceHeaders).forEach((name) => methods.setRequestHeader.call(request, name, traceHeaders[name]));
    request.timeout = 12_000;

    let completed = false;
    const finish = (statusCode: number, responseBody: string, failed: boolean): void => {
      if (completed) return;
      completed = true;
      const finishedAt = nowNs();
      truewatchSdk.rum.stopResource(resourceKey, { ...attributes, request_failed: failed });
      truewatchSdk.rum.addResource(resourceKey, {
        url: TRACE_TEST_URL,
        httpMethod: 'GET',
        requestHeaders: traceHeaders,
        statusCode,
        responseContentType: request.getResponseHeader('content-type') || undefined,
        responseBody: responseBody.slice(0, 256),
      }, {
        fetchStartTime: startedAt,
        responseStartTime: finishedAt,
        responseEndTime: finishedAt,
      });
      truewatchSdk.logger.log(
        `Creator 3 trace test completed with status ${statusCode}`,
        failed ? 'warning' : 'info',
        attributes,
      );
      this.setStatus(
        failed ? `Trace test failed (${statusCode}); Resource was still reported` : `Trace + linked RUM Resource reported (${statusCode})`,
        failed ? COLORS.warning : COLORS.primary,
      );
    };

    request.onload = () => finish(request.status, request.responseText || '', request.status < 200 || request.status >= 400);
    request.onerror = () => finish(0, 'network error', true);
    request.ontimeout = () => finish(0, 'request timeout', true);
    methods.send.call(request);
  }

  private emitError(): void {
    const error = new Error('Creator 3 Hybrid sample diagnostic error');
    const attributes = { ...ATTRIBUTES, error_source: 'manual_button' };
    truewatchSdk.rum.addAction('creator3_error_clicked', 'click', attributes);
    truewatchSdk.rum.addError(error.message, error.stack || '', 'sample_error', 'run', attributes);
    truewatchSdk.logger.log(error.message, 'error', attributes);
    this.setStatus('RUM Error + linked error Log emitted', COLORS.danger);
  }

  private changeReplayState(): void {
    this.replayState += 1;
    const palette = [COLORS.info, COLORS.primary, COLORS.warning, COLORS.danger];
    const color = palette[this.replayState % palette.length];
    if (this.replayCard) {
      this.replayCard.clear();
      this.replayCard.fillColor = color;
      this.replayCard.roundRect(-360, -50, 720, 100, 18);
      this.replayCard.fill();
    }
    const attributes = { ...ATTRIBUTES, replay_state: this.replayState };
    truewatchSdk.rum.addAction('creator3_replay_state_changed', 'click', attributes);
    truewatchSdk.logger.log(`Replay visual state changed to ${this.replayState}`, 'info', attributes);
    this.setStatus(`Replay visual state changed: ${this.replayState}`, color);
  }

  private toggleMaskFit(): void {
    this.maskShowAll = !this.maskShowAll;
    const scenario = this.maskShowAll ? 'show_all' : 'fixed_height';
    view.setDesignResolutionSize(960, 640, this.maskShowAll ? ResolutionPolicy.SHOW_ALL : ResolutionPolicy.FIXED_HEIGHT);
    truewatchSdk.rum.addAction('creator3_mask_fit_changed', 'click', { ...ATTRIBUTES, mask_scenario: scenario });
    this.setStatus(`Mask verification: ${scenario} · private token must stay gray in Replay`, COLORS.primary);
  }

  private openNativePage(): void {
    try {
      this.leaveCocosPage();
      this.setStatus('Returning RUM View and Replay ownership to the native page…', COLORS.info);
      if (sys.os === sys.OS.ANDROID) {
        callNativeStatic(
          'com/truewatch/cocos/sample/HybridSampleSdk',
          'returnToNative',
          '()V',
        );
        return;
      }
      if (sys.os === sys.OS.IOS) {
        callNativeStatic('HybridSampleSDK', 'showNativePage');
        this.waitForNativeReturn();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`Unable to open native page: ${message}`, COLORS.danger);
    }
  }

  private waitForNativeReturn(): void {
    if (this.waitingForNativeReturn) return;
    this.waitingForNativeReturn = true;
    const check = (): void => {
      if (!this.isNativePageVisible()) {
        this.waitingForNativeReturn = false;
        try {
          this.enterCocosPage();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.setStatus(`Unable to re-enter Cocos: ${message}`, COLORS.danger);
        }
        return;
      }
      setTimeout(check, 200);
    };
    setTimeout(check, 200);
  }

  private isNativePageVisible(): boolean {
    if (sys.os === sys.OS.ANDROID) {
      return callNativeStatic(
        'com/truewatch/cocos/sample/HybridSampleSdk',
        'isNativePageVisible',
        '()Z',
      ) === true;
    }
    if (sys.os === sys.OS.IOS) {
      return callNativeStatic('HybridSampleSDK', 'isNativePageVisible') === true;
    }
    return false;
  }

  private createScene(): { root: Node; camera: Camera } {
    const scene = new Scene(VIEW_NAME);
    const cameraNode = new Node('ReplayCamera');
    cameraNode.layer = Layers.Enum.UI_2D;
    cameraNode.setPosition(0, 0, 1000);
    scene.addChild(cameraNode);
    const camera = cameraNode.addComponent(Camera);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.orthoHeight = Math.max(320, view.getVisibleSize().height / 2);
    camera.visibility = Layers.Enum.UI_2D;
    camera.clearColor = COLORS.background;

    const canvasNode = new Node('Canvas');
    canvasNode.layer = Layers.Enum.UI_2D;
    scene.addChild(canvasNode);
    canvasNode.addComponent(UITransform).setContentSize(960, 640);
    const canvas = canvasNode.addComponent(Canvas);
    canvas.cameraComponent = camera;

    const root = new Node('HybridTelemetryUI');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(960, 640);
    canvasNode.addChild(root);
    director.runSceneImmediate(scene);
    return { root, camera };
  }

  private render(root: Node): void {
    this.panel(root, 'Background', 0, 0, 960, 640, COLORS.background);
    this.label(root, 'Cocos Hybrid · Creator 3', 0, 258, 860, 48, 34, COLORS.text);
    this.label(root, 'Native host owns SDK modules; Cocos attaches RUM automation and canvas Replay.', 0, 218, 860, 30, 17, COLORS.muted);

    const replayNode = this.panel(root, 'ReplayVisualState', 0, 125, 720, 100, COLORS.info);
    this.replayCard = replayNode.getComponent(Graphics) || undefined;
    this.label(replayNode, 'SESSION REPLAY VISUAL STATE', -125, 10, 390, 28, 22, COLORS.text);
    this.label(replayNode, 'The token at right must be gray in Replay.', -125, -24, 390, 24, 15, COLORS.text);
    this.privacyMaskProbe = this.panel(replayNode, 'PrivacyMaskProbe', 225, 0, 220, 70, COLORS.danger);
    this.label(this.privacyMaskProbe, 'PRIVATE TOKEN\nMASK-ME-8391', 0, 0, 190, 52, 17, COLORS.text);

    this.button(root, 'AutoNetwork', 'Auto Network', -270, 28, 220, 56, () => this.emitAutomaticResource(), COLORS.info);
    this.button(root, 'ManualNetwork', 'Manual Trace', 0, 28, 220, 56, () => this.emitManualTraceResource(), COLORS.primary);
    this.button(root, 'RumLog', 'RUM + Log', 270, 28, 220, 56, () => this.emitRumAndLog(), COLORS.primary);
    this.button(root, 'RumError', 'RUM Error', -270, -48, 220, 56, () => this.emitError(), COLORS.danger);
    this.button(root, 'ReplayChange', 'Replay change', 0, -48, 220, 56, () => this.changeReplayState(), COLORS.warning);
    this.button(root, 'NativePage', 'Native page', 270, -48, 220, 56, () => this.openNativePage(), COLORS.info);
    this.button(root, 'MaskFit', 'Mask: toggle fit', 0, -108, 260, 40, () => this.toggleMaskFit(), COLORS.primary);

    const statusPanel = this.panel(root, 'StatusPanel', 0, -180, 780, 84, COLORS.panel);
    this.status = this.label(statusPanel, 'Preparing Hybrid integration…', 0, 0, 730, 50, 18, COLORS.muted);
    this.label(root, `View: ${VIEW_NAME}`, 0, -258, 820, 24, 15, COLORS.muted);
  }

  private panel(parent: Node, name: string, x: number, y: number, width: number, height: number, color: Color): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = color;
    graphics.roundRect(-width / 2, -height / 2, width, height, Math.min(18, height / 4));
    graphics.fill();
    return node;
  }

  private button(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, onClick: () => void, color: Color): void {
    const node = this.panel(parent, name, x, y, width, height, color);
    node.addComponent(Button);
    node.on(Button.EventType.CLICK, onClick);
    this.label(node, text, 0, 0, width - 16, height - 8, 18, COLORS.text);
  }

  private label(parent: Node, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: Color): Label {
    const node = new Node(`Label-${text.slice(0, 18)}`);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.ceil(fontSize * 1.3);
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }

  private setStatus(text: string, color: Color): void {
    if (!this.status?.node.isValid) return;
    this.status.string = text;
    this.status.color = color;
  }
}

function nowNs(): number {
  return Date.now() * 1_000_000;
}

function callNativeStatic(...argumentsList: unknown[]): unknown {
  const call = native.reflection.callStaticMethod as (...values: unknown[]) => unknown;
  return call(...argumentsList);
}
