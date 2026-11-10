import { SampleDashboard, dashboardViewport, statusPages, DashboardAction, DashboardViewport } from '../acceptance-components/SampleDashboard';
import { WebViewValidationScene } from './WebViewValidationScene';
import { ReplayVersionDiffScene } from './ReplayVersionDiffScene';
import { ReplayEvidenceScene } from './ReplayEvidenceScene';
import { ReplayNativeScene } from './ReplayNativeScene';
import { ReplayAssetScene } from './ReplayAssetScene';
import { ReplayMotionScene } from './ReplayMotionScene';
import { ReplayEffectsScene } from './ReplayEffectsScene';
import { ReplayLayoutScene } from './ReplayLayoutScene';
import { ReplayScrollScene } from './ReplayScrollScene';
import { ReplayBasicScene } from './ReplayBasicScene';
import { ReplayInputScene } from './ReplayInputScene';
import StarportScene from './StarportScene';
import ReplayPrivacy, { ReplayPrivacyMode } from '../truewatch-cocos-sdk/ReplayPrivacy';
import { truewatchSdk as baseSdk } from '@truewatchtech/cocos-sdk/creator2';
import { withSessionReplay } from '@truewatchtech/cocos-session-replay/creator2';

// Creator 2 evaluates scene scripts during export, before the native runtime exists.
let truewatchSdk: ReturnType<typeof withSessionReplay>;

const { ccclass } = cc._decorator;

const VIEW_NAME = 'CocosHybridCreator2Sample';
const AUTO_TEST_URL = 'https://httpbin.org/get?sample=cocos-hybrid-creator2&collection=automatic';
const TRACE_TEST_URL = 'https://httpbin.org/get?sample=cocos-hybrid-creator2&collection=manual';
const ATTRIBUTES = {
  sample_name: 'cocos-hybrid-creator2',
  creator_generation: '2',
  integration_mode: 'hybrid',
};

const COLORS = {
  background: cc.color(12, 18, 34, 255),
  panel: cc.color(27, 39, 64, 255),
  primary: cc.color(44, 202, 178, 255),
  info: cc.color(73, 142, 245, 255),
  warning: cc.color(245, 166, 35, 255),
  danger: cc.color(236, 83, 103, 255),
  text: cc.color(239, 244, 255, 255),
  muted: cc.color(151, 164, 190, 255),
};

let activeSample: HybridTelemetryRuntime | undefined;

/** Startup component for the Creator 2 Hybrid integration sample. */
@ccclass
export default class HybridTelemetrySample extends cc.Component {
  start(): void {
    if (activeSample) return;
    if (cc.sys.isNative) truewatchSdk = withSessionReplay(baseSdk);
    activeSample = new HybridTelemetryRuntime();
    activeSample.start();
  }
}

/** Call this only when the native host removes or leaves the Cocos container. */
export function leaveHybridCocos(): void {
  if (activeSample) activeSample.leaveCocosPage();
  else truewatchSdk?.leaveCocos();
}

interface UntrackedXhrMethods {
  open: (this: XMLHttpRequest, method: string, url: string, async?: boolean) => void;
  send: (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;
  setRequestHeader: (this: XMLHttpRequest, name: string, value: string) => void;
}

class HybridTelemetryRuntime {
  private dashboard = new SampleDashboard(2);
  private dashboardSize: DashboardViewport = { width: 960, height: 640, compact: false };
  private privacyPage = false;
  private lastStatus = 'Ready to test';
  private lastStatusColor = COLORS.muted;
  private detailsNode?: cc.Node;
  private inputCoverageNode?: cc.Node;
  private sampleRoot?: cc.Node;
  private gameNode?: cc.Node;
  private status?: cc.Label;
  private replayCard?: cc.Graphics;
  private privacyMaskProbe?: cc.Node;
  private privacyProbeGroup?: cc.Node;
  private privacyLayoutMoved = false;
  private replayState = 0;
  private maskShowAll = true;
  private replayCamera?: cc.Camera;
  private resourceSequence = 0;
  private entered = false;
  private entering = false;
  private waitingForNativeReturn = false;
  private untrackedXhr?: UntrackedXhrMethods;

  start(): void {
    const scene = this.createScene();
    this.replayCamera = scene.camera;
    truewatchSdk?.setReplayCamera(scene.camera);
    this.sampleRoot = scene.root;
    this.render(scene.root);
    cc.view.on('canvas-resize', this.refreshDashboardSize, this);

    if (!cc.sys.isNative) {
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
          imagePolicy: { quality: 'medium', maxFrameBytes: 40 * 1024 },
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
    if (this.entered || this.entering) return;
    this.entering = true;
    // Let Creator 2 present its first screen frame before starting Replay,
    // including when the native host resumes a restarted Cocos process.
    cc.director.once(cc.Director.EVENT_AFTER_DRAW, () => {
      this.entering = false;
      if (this.entered) return;
      truewatchSdk.enterCocos({ viewName: VIEW_NAME });
      this.entered = true;
      truewatchSdk.rum.addAction('hybrid_sample_entered_cocos', 'launch', ATTRIBUTES);
      truewatchSdk.logger.log('Creator 2 Hybrid sample entered Cocos', 'info', ATTRIBUTES);
      this.setStatus('Cocos page active · automatic and manual network samples ready', COLORS.primary);
    });
  }

  leaveCocosPage(): void {
    if (!this.entered) return;
    truewatchSdk.leaveCocos();
    this.entered = false;
  }

  private emitRumAndLog(): void {
    if (!cc.sys.isNative) { this.setStatus('Telemetry controls require an Android or iOS build.', COLORS.warning); return; }
    const attributes = { ...ATTRIBUTES, button: 'rum_log', emitted_at: Date.now() };
    truewatchSdk.rum.addAction('rum_log_clicked', 'click', attributes);
    truewatchSdk.logger.log('Creator 2 sample emitted a RUM Action and linked Log', 'info', attributes);
    this.setStatus('RUM Action + linked Log emitted', COLORS.primary);
  }

  private emitAutomaticResource(): void {
    if (!cc.sys.isNative) { this.setStatus('Telemetry controls require an Android or iOS build.', COLORS.warning); return; }
    const url = `${AUTO_TEST_URL}&request_id=${Date.now().toString(36)}-${++this.resourceSequence}`;
    const attributes = { ...ATTRIBUTES, collection_mode: 'automatic', request_url: url };
    const request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.timeout = 12_000;
    this.setStatus('Automatic XHR in progress · SDK owns Resource and Trace', COLORS.info);
    request.onload = () => {
      const failed = request.status < 200 || request.status >= 400;
      truewatchSdk.logger.log(
        `Creator 2 automatic network completed with status ${request.status}`,
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
    if (!cc.sys.isNative) { this.setStatus('Telemetry controls require an Android or iOS build.', COLORS.warning); return; }
    const methods = this.untrackedXhr;
    if (!methods) {
      this.setStatus('Original XHR methods are unavailable for the manual sample', COLORS.danger);
      return;
    }
    const resourceKey = `creator2-manual-trace-${Date.now().toString(36)}-${++this.resourceSequence}`;
    const startedAt = nowNs();
    const traceHeaders = truewatchSdk.trace.getHeaders(TRACE_TEST_URL, resourceKey);
    const attributes = {
      ...ATTRIBUTES,
      collection_mode: 'manual',
      resource_key: resourceKey,
      trace_link_rum: true,
    };

    truewatchSdk.rum.startResource(resourceKey, attributes);
    truewatchSdk.rum.addAction('trace_request_started', 'network', attributes);
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
        `Creator 2 trace test completed with status ${statusCode}`,
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
    if (!cc.sys.isNative) { this.setStatus('Telemetry controls require an Android or iOS build.', COLORS.warning); return; }
    const error = new Error('Creator 2 Hybrid sample diagnostic error');
    const attributes = { ...ATTRIBUTES, error_source: 'manual_button' };
    truewatchSdk.rum.addAction('error_clicked', 'click', attributes);
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
      this.replayCard.roundRect(-360, -70, 720, 140, 18);
      this.replayCard.fill();
    }
    const attributes = { ...ATTRIBUTES, replay_state: this.replayState };
    if (this.entered) truewatchSdk.rum.addAction('replay_state_changed', 'click', attributes);
    if (this.entered) truewatchSdk.logger.log(`Replay visual state changed to ${this.replayState}`, 'info', attributes);
    this.setStatus(`Replay visual state changed: ${this.replayState}`, color);
  }

  private toggleMaskFit(): void {
    this.maskShowAll = !this.maskShowAll;
    cc.view.setDesignResolutionSize(960, 640, this.maskShowAll ? cc.ResolutionPolicy.SHOW_ALL : cc.ResolutionPolicy.FIXED_HEIGHT);
    if (this.entered) truewatchSdk.rum.addAction('mask_fit_changed', 'click', { ...ATTRIBUTES, mask_scenario: this.maskShowAll ? 'show_all' : 'fixed_height' });
    this.setStatus('Mask fit changed: private targets stay masked; public guards stay visible', COLORS.primary);
  }

  private toggleMaskCamera(): void {
    const camera = this.replayCamera;
    if (!camera) return;
    camera.node.is3DNode = !camera.node.is3DNode;
    const scenario = camera.node.is3DNode ? 'camera_3d' : 'camera_2d';
    if (this.entered) truewatchSdk.rum.addAction('creator2_mask_camera_changed', 'click', { ...ATTRIBUTES, mask_scenario: scenario });
    this.setStatus(`Mask verification: ${scenario} · private token must stay gray in Replay`, COLORS.primary);
  }

  private togglePrivacyLayout(): void {
    this.privacyLayoutMoved = !this.privacyLayoutMoved;
    const group = this.privacyProbeGroup;
    if (!group) return;
    const scale = this.privacyLayoutMoved ? 0.85 : 1;
    group.setPosition(this.privacyLayoutMoved ? 36 : 0, this.privacyLayoutMoved ? 82 : 95);
    group.setScale(scale, scale);
    this.setStatus('Privacy layout changed: only the three red targets should be masked in Replay', COLORS.primary);
  }

  private openNativePage(): void {
    if (!cc.sys.isNative) { this.setStatus('Native page requires an Android or iOS build.', COLORS.warning); return; }
    try {
      this.leaveCocosPage();
      this.setStatus('Returning RUM View and Replay ownership to the native page…', COLORS.info);
      if (cc.sys.os === cc.sys.OS_ANDROID) {
        callNativeStatic(
          'com/truewatch/cocos/sample/HybridSampleSdk',
          'returnToNative',
          '()V',
        );
        this.waitForNativeReturn();
        return;
      }
      if (cc.sys.os === cc.sys.OS_IOS) {
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
    if (cc.sys.os === cc.sys.OS_ANDROID) {
      return callNativeStatic(
        'com/truewatch/cocos/sample/HybridSampleSdk',
        'isNativePageVisible',
        '()Z',
      ) === true;
    }
    if (cc.sys.os === cc.sys.OS_IOS) {
      return callNativeStatic('HybridSampleSDK', 'isNativePageVisible') === true;
    }
    return false;
  }

  private createScene(): { root: cc.Node; camera: cc.Camera } {
    const scene = new cc.Scene();
    scene.name = VIEW_NAME;

    const cameraNode = new cc.Node('ReplayCamera');
    cameraNode.z = 1000;
    scene.addChild(cameraNode);
    const camera = cameraNode.addComponent(cc.Camera);
    camera.ortho = true;
    camera.orthoSize = Math.max(320, cc.view.getVisibleSize().height / 2);
    camera.backgroundColor = COLORS.background;
    // iOS preserves the drawable's color between frames. Clear the full camera
    // viewport so resized UI and hidden profiler labels cannot leave trails.
    camera.clearFlags |= cc.Camera.ClearFlags.COLOR;

    const canvasNode = new cc.Node('Canvas');
    canvasNode.setContentSize(960, 640);
    scene.addChild(canvasNode);
    const canvas = canvasNode.addComponent(cc.Canvas);
    canvas.designResolution = cc.size(960, 640);
    canvas.fitHeight = true;
    // Runtime Canvas exposes camera; Creator 2 declarations omit this accessor.
    (canvas as cc.Canvas & { camera: cc.Camera }).camera = camera;

    const root = new cc.Node('HybridTelemetryUI');
    root.setContentSize(960, 640);
    canvasNode.addChild(root);
    cc.director.runSceneImmediate(scene);
    return { root, camera };
  }

  private setSampleViewport(width: number, height: number, showAll = true): void {
    if (!this.sampleRoot) return;
    this.sampleRoot.setContentSize(width, height);
    const canvas = this.sampleRoot.parent!.getComponent(cc.Canvas)!;
    canvas.designResolution = cc.size(width, height);
    canvas.fitWidth = true;
    canvas.fitHeight = true;
    if (this.replayCamera) this.replayCamera.orthoSize = height / 2;
    cc.view.setDesignResolutionSize(width, height, !showAll ? cc.ResolutionPolicy.FIXED_HEIGHT : cc.ResolutionPolicy.SHOW_ALL);
  }

  private refreshDashboardSize(): void {
    if (!this.sampleRoot?.activeInHierarchy || this.privacyPage) return;
    const frame = cc.view.getFrameSize();
    const next = dashboardViewport(frame.width, frame.height);
    if (next.width !== this.dashboardSize.width || next.height !== this.dashboardSize.height) this.render(this.sampleRoot);
  }

  private render(root: cc.Node): void {
    if (this.privacyMaskProbe) truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe, 'unmask');
    root.children.slice().forEach(child => { child.active = false; child.destroy(); });
    this.detailsNode = undefined;
    this.privacyMaskProbe = undefined;
    this.privacyProbeGroup = undefined;
    this.replayCard = undefined;
    const frame = cc.view.getFrameSize();
    this.dashboardSize = this.privacyPage ? { width: 960, height: 640, compact: false } : dashboardViewport(frame.width, frame.height);
    const { width, height } = this.dashboardSize;
    this.setSampleViewport(width, height, !this.privacyPage || this.maskShowAll);
    this.panel(root, 'Background', 0, 0, width, height, COLORS.background);
    this.label(root, 'Cocos Sample', -width / 2 + 136, height / 2 - 44, 224, 48, width < 640 ? 26 : 30, COLORS.text);
    if (width > 640) this.label(root, 'Creator 2', 16, height / 2 - 44, 170, 36, 20, COLORS.primary);
    this.button(root, 'NativePage', 'Native page', width / 2 - 112, height / 2 - 44, 176, 56, () => this.openNativePage(), COLORS.info);

    if (this.privacyPage) {
      this.renderPrivacy(root);
    } else {
      this.dashboard.render({
        label: (text, x, y, w, h, size, tone) => { this.label(root, text, x, y, w, h, size, COLORS[tone]); },
        button: (name, text, x, y, w, h, click, tone) => this.button(root, name, text, x, y, w, h, click, COLORS[tone]),
        card: (entry, x, y, w, h, click) => {
          const card = this.panel(root, entry.id, x, y, w, h, COLORS.panel);
          card.addComponent(cc.Button).transition = cc.Button.Transition.NONE;
          card.on('click', click);
          this.label(card, entry.title, 0, 19, w - 32, 40, 26, COLORS.text);
          this.label(card, entry.description, 0, -27, w - 32, 36, 17, COLORS.muted);
        },
      }, this.dashboardSize, () => this.render(root), action => this.runDashboardAction(action));
    }
    this.panel(root, 'StatusPanel', 0, -height / 2 + 46, width - 32, 68, COLORS.panel);
    this.status = this.label(root, '', -90, -height / 2 + 46, width - 240, 52, 18, this.lastStatusColor);
    this.button(root, 'StatusDetails', 'Details', width / 2 - 112, -height / 2 + 46, 176, 56, () => this.showStatusDetails(), COLORS.panel);
    this.setStatus(this.lastStatus, this.lastStatusColor);
  }

  private openPrivacy(): void {
    if (!this.sampleRoot) return;
    this.privacyPage = true;
    this.privacyLayoutMoved = false;
    this.replayState = 0;
    this.render(this.sampleRoot);
  }

  private renderPrivacy(root: cc.Node): void {
    this.button(root, 'BackToCategories', '‹ Categories', -350, 208, 212, 56, () => {
      this.privacyPage = false;
      if (this.replayCamera) this.replayCamera.node.is3DNode = false;
      this.render(root);
    }, COLORS.panel);
    this.label(root, 'Replay & privacy', 100, 208, 420, 40, 26, COLORS.text);
    const replayNode = this.panel(root, 'ReplayVisualState', 0, 95, 720, 140, COLORS.panel);
    this.privacyProbeGroup = replayNode;
    this.replayCard = replayNode.getComponent(cc.Graphics) || undefined;
    this.label(replayNode, 'COMPONENT MASK', -230, 49, 200, 22, 15, COLORS.text);
    this.label(replayNode, 'COMPONENT HIDE', 0, 49, 200, 22, 15, COLORS.text);
    this.label(replayNode, 'CODE MASK', 230, 49, 200, 22, 15, COLORS.text);

    const componentMask = this.panel(replayNode, 'ComponentMaskProbe', -230, 0, 180, 58, COLORS.danger, true);
    componentMask.addComponent(ReplayPrivacy);
    this.label(componentMask, 'PRIVATE TOKEN\nCOMPONENT-3141', 0, 0, 170, 48, 15, COLORS.text);
    const componentHide = this.panel(replayNode, 'ComponentHideProbe', 0, 0, 180, 58, COLORS.danger, true);
    componentHide.addComponent(ReplayPrivacy).mode = ReplayPrivacyMode.Hide;
    this.label(componentHide, 'PRIVATE TOKEN\nHIDE-ME-2718', 0, 0, 170, 48, 15, COLORS.text);
    this.privacyMaskProbe = this.panel(replayNode, 'PrivacyMaskProbe', 230, 0, 180, 58, COLORS.danger, true);
    this.label(this.privacyMaskProbe, 'PRIVATE TOKEN\nMASK-ME-8391', 0, 0, 170, 48, 15, COLORS.text);
    truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe, 'mask');

    // Guards are siblings: including them in a private subtree would mask them too.
    [-230, 0, 230].forEach((x, index) => {
      this.panel(replayNode, `PublicGuardLeft${index}`, x - 94, 0, 4, 58, COLORS.primary, true);
      this.panel(replayNode, `PublicGuardRight${index}`, x + 94, 0, 4, 58, COLORS.primary, true);
      this.panel(replayNode, `PublicGuardTop${index}`, x, 33, 180, 4, COLORS.primary, true);
      this.panel(replayNode, `PublicGuardBottom${index}`, x, -33, 180, 4, COLORS.primary, true);
    });
    this.label(replayNode, 'KEEP\nME', -115, 0, 38, 44, 12, COLORS.text);
    this.label(replayNode, 'KEEP\nME', 115, 0, 38, 44, 12, COLORS.text);
    this.label(replayNode, 'PUBLIC: all green edges and KEEP ME labels must stay visible', 0, -52, 690, 22, 15, COLORS.primary);


    this.button(root, 'ReplayChange', 'Replay change', -210, -36, 360, 64, () => this.changeReplayState(), COLORS.primary);
    this.button(root, 'MaskFit', 'Toggle fit', 210, -36, 360, 64, () => this.toggleMaskFit(), COLORS.info);
    this.button(root, 'PrivacyLayout', 'Move + scale', -210, -118, 360, 64, () => this.togglePrivacyLayout(), COLORS.primary);
    this.button(root, 'MaskCamera', 'Camera 2D / 3D', 210, -118, 360, 64, () => this.toggleMaskCamera(), COLORS.info);
    this.label(root, 'Mask or hide the three private targets. Keep the green guards and KEEP ME visible.', 0, -202, 880, 44, 18, COLORS.muted);
  }

  private runDashboardAction(action: DashboardAction): void {
    switch (action) {
      case 'AutoNetwork': this.emitAutomaticResource(); break;
      case 'ManualNetwork': this.emitManualTraceResource(); break;
      case 'RumLog': this.emitRumAndLog(); break;
      case 'RumError': this.emitError(); break;
      case 'Privacy': this.openPrivacy(); break;
      case 'ReplayChange': this.openPrivacy(); this.changeReplayState(); break;
      case 'StarportGame': this.openGame(); break;
      case 'InputCoverage': void this.openCoverage('input'); break;
      case 'BasicCoverage': void this.openCoverage('basic'); break;
      case 'ScrollCoverage': void this.openCoverage('scroll'); break;
      case 'LayoutCoverage': void this.openCoverage('layout'); break;
      case 'WebViewValidation': void this.openCoverage('webview'); break;
      case 'EffectsCoverage': void this.openCoverage('effects'); break;
      case 'MotionCoverage': void this.openCoverage('motion'); break;
      case 'AssetCoverage': void this.openCoverage('assets'); break;
      case 'EvidenceCoverage': void this.openCoverage('evidence'); break;
      case 'VersionDiffCoverage': void this.openCoverage('version-diff'); break;
      case 'NativeCoverage': void this.openCoverage('native'); break;
    }
  }

  private showStatusDetails(): void {
    if (!this.sampleRoot || this.detailsNode) return;
    const { width, height } = this.dashboardSize;
    const overlay = this.panel(this.sampleRoot, 'StatusDetailOverlay', 0, 0, width, height, COLORS.background);
    this.detailsNode = overlay;
    overlay.addComponent(cc.BlockInputEvents);
    this.label(overlay, 'Latest result', 0, height / 2 - 52, width - 48, 48, 28, COLORS.text);
    // Paginate long errors without shrinking the text or clipping their tail.
    const chunks = statusPages(this.lastStatus, width, height);
    let page = 0;
    const body = this.label(overlay, chunks[0], 0, 24, width - 96, height - 324, 22, this.lastStatusColor);
    const count = this.label(overlay, `1 / ${chunks.length}`, 0, height / 2 - 104, 220, 36, 20, COLORS.muted);
    const turn = (delta: number): void => {
      page = Math.max(0, Math.min(chunks.length - 1, page + delta));
      body.string = chunks[page];
      count.string = `${page + 1} / ${chunks.length}`;
    };
    if (chunks.length > 1) {
      this.button(overlay, 'PreviousDetail', 'Previous', -112, -height / 2 + 146, 160, 56, () => turn(-1), COLORS.panel);
      this.button(overlay, 'NextDetail', 'Next', 112, -height / 2 + 146, 160, 56, () => turn(1), COLORS.panel);
    }
    this.button(overlay, 'CloseDetails', 'Close details', 0, -height / 2 + 62, 240, 64, () => {
      overlay.active = false;
      overlay.destroy();
      this.detailsNode = undefined;
    }, COLORS.info);
  }

  private async openCoverage(kind: 'webview' | 'input' | 'basic' | 'scroll' | 'layout' | 'effects' | 'motion' | 'assets' | 'native' | 'evidence' | 'version-diff'): Promise<void> {
    if (this.inputCoverageNode || !this.sampleRoot) return;
    const sampleRoot = this.sampleRoot;
    const previousClearFlags = this.replayCamera && this.replayCamera.clearFlags;
    const previousOrtho = this.replayCamera && this.replayCamera.ortho;
    // The 3D coverage page has no opaque full-screen UI panel.
    if (kind === "native" && this.replayCamera) {
      this.replayCamera.clearFlags = cc.Camera.ClearFlags.COLOR | cc.Camera.ClearFlags.DEPTH | cc.Camera.ClearFlags.STENCIL;
      // Keep screen-aligned controls at z=0, with perspective depth for the meshes.
      this.replayCamera.ortho = false;
    }
    this.setSampleViewport(960, 640);
    sampleRoot.active = false;
    if (this.privacyMaskProbe) truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe, 'unmask');
    const node = new cc.Node('ReplayCoverage');
    sampleRoot.parent!.addChild(node);
    this.inputCoverageNode = node;
    const restore = (): void => {
      if (this.inputCoverageNode !== node) return;
      this.inputCoverageNode = undefined;
      if (this.replayCamera && previousClearFlags !== undefined) this.replayCamera.clearFlags = previousClearFlags;
      if (this.replayCamera && previousOrtho !== undefined) this.replayCamera.ortho = previousOrtho;
      node.active = false;
      node.destroy();
      this.privacyLayoutMoved = false;
      this.replayState = 0;
      sampleRoot.active = true;
      this.render(sampleRoot);
      this.setStatus('Coverage closed · reopen to verify fresh state', COLORS.primary);
      truewatchSdk?.setReplayCamera(this.replayCamera);
      if (this.entered) { truewatchSdk.rum.stopView(); truewatchSdk.rum.startView(VIEW_NAME, ATTRIBUTES); }
    };
    try {
      if (this.entered) { truewatchSdk.rum.stopView(); truewatchSdk.rum.startView(kind === 'webview' ? 'WebView/Validation' : kind === 'version-diff' ? 'Replay/VersionDiffCoverage' : kind === 'input' ? 'Replay/InputCoverage' : kind === 'basic' ? 'Replay/BasicCoverage' : kind === 'scroll' ? 'Replay/ScrollCoverage' : kind === 'layout' ? 'Replay/LayoutCoverage' : kind === 'effects' ? 'Replay/EffectsCoverage' : kind === 'motion' ? 'Replay/MotionCoverage' : kind === 'native' ? 'Replay/NativeCoverage' : 'Replay/AssetCoverage', ATTRIBUTES); }
      const scene = kind === 'webview' ? node.addComponent(WebViewValidationScene) : kind === 'version-diff' ? node.addComponent(ReplayVersionDiffScene) : kind === 'evidence' ? node.addComponent(ReplayEvidenceScene) : kind === 'input' ? node.addComponent(ReplayInputScene) : kind === 'basic' ? node.addComponent(ReplayBasicScene) : kind === 'scroll' ? node.addComponent(ReplayScrollScene) : kind === 'layout' ? node.addComponent(ReplayLayoutScene) : kind === 'effects' ? node.addComponent(ReplayEffectsScene) : kind === 'motion' ? node.addComponent(ReplayMotionScene) : kind === 'native' ? node.addComponent(ReplayNativeScene) : node.addComponent(ReplayAssetScene);
      await scene.initialize(restore, (caseId: string, stage: string) => {
        console.log('[ReplayFull249]', JSON.stringify({ engine: cc.ENGINE_VERSION, kind, case_id: caseId, stage, hostTime: Date.now() }));
        if (!this.entered) return;
        // Only fixed case identifiers and phases leave this page; never forward input payloads.
        truewatchSdk.rum.addAction(`replay_${kind}_case`, 'custom', { ...ATTRIBUTES, case_id: caseId, stage });
      });
    } catch (error) { console.error("[ReplayCoverage] initialization failed", String(error), error && (error as Error).stack); restore(); this.setStatus(`Unable to open coverage: ${String(error)}`, COLORS.danger); }
  }

  private openGame(): void {
    if (this.gameNode || !this.sampleRoot) return;
    const sampleRoot = this.sampleRoot;
    // The shared game uses the same screen camera, so HUD and gameplay are captured together.
    this.setSampleViewport(960, 640);
    sampleRoot.active = false;
    if (this.privacyMaskProbe) truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe, 'unmask');
    const node = new cc.Node('StarportGame');

    sampleRoot.parent!.addChild(node);
    this.gameNode = node;
    const restore = (): void => {
      if (this.gameNode !== node) return;
      this.gameNode = undefined;
      node.active = false;
      node.destroy();
      // Rebuild procedural Graphics after returning; native 3.x can lose their
      // uploaded geometry when the old UI subtree is disabled and re-enabled.
      this.privacyLayoutMoved = false;
      this.replayState = 0;
      sampleRoot.active = true;
      this.render(sampleRoot);
      this.setStatus(this.entered ? 'Cocos page active · automatic and manual network samples ready' : 'Editor preview only. Build Android or iOS to call the native bridge.', this.entered ? COLORS.primary : COLORS.warning);
      truewatchSdk?.setReplayCamera(this.replayCamera);
      if (this.privacyMaskProbe) truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe, 'mask');
      if (this.entered) { truewatchSdk.rum.stopView(); truewatchSdk.rum.startView(VIEW_NAME, ATTRIBUTES); }
    };
    try {
      node.addComponent(StarportScene).initialize({
        exit: restore,
        page: name => {
          if (!this.entered) return;
          truewatchSdk.rum.stopView();
          truewatchSdk.rum.startView(`Starport/${name}`, { ...ATTRIBUTES, game: 'starport' });
        },
        track: (action, attributes) => {
          if (!this.entered) return;
          const fields = { ...ATTRIBUTES, ...attributes };
          truewatchSdk.rum.addAction(action, 'custom', fields);
          truewatchSdk.logger.log(`starport ${action}`, 'info', fields);
        },
      }, this.replayCamera!);
    } catch (error) { restore(); this.setStatus(`Unable to open game: ${String(error)}`, COLORS.danger); }
  }

  private panel(parent: cc.Node, name: string, x: number, y: number, width: number, height: number, color: cc.Color, square = false): cc.Node {
    const node = new cc.Node(name);
    parent.addChild(node);
    node.setPosition(x, y);
    node.setContentSize(width, height);
    const graphics = node.addComponent(cc.Graphics);
    graphics.fillColor = color;
    if (square) graphics.rect(-width / 2, -height / 2, width, height);
    else graphics.roundRect(-width / 2, -height / 2, width, height, Math.min(18, height / 4));
    graphics.fill();
    return node;
  }

  private button(parent: cc.Node, name: string, text: string, x: number, y: number, width: number, height: number, onClick: () => void, color: cc.Color): void {
    const node = this.panel(parent, name, x, y, width, height, color);
    node.addComponent(cc.Button).transition = cc.Button.Transition.NONE;
    node.on('click', onClick);
    this.label(node, text, 0, 0, width - 24, height - 8, 20, color === COLORS.primary ? COLORS.background : COLORS.text);
  }

  private label(parent: cc.Node, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: cc.Color): cc.Label {
    const node = new cc.Node(`Label-${text.slice(0, 18)}`);
    parent.addChild(node);
    node.setPosition(x, y);
    const label = node.addComponent(cc.Label);
    label.useSystemFont = true;
    label.fontFamily = 'Arial';
    // Adding cc.Label starts in Overflow.NONE and resets the node size. Set the
    // overflow policy first, then restore the intended layout bounds.
    label.overflow = cc.Label.Overflow.CLAMP;
    node.setContentSize(width, height);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.ceil(fontSize * 1.3);
    label.node.color = color;
    label.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
    label.verticalAlign = cc.Label.VerticalAlign.CENTER;
    return label;
  }

  private setStatus(text: string, color: cc.Color): void {
    this.lastStatus = text;
    this.lastStatusColor = color;
    if (!this.status || !cc.isValid(this.status.node)) return;
    const summary = text.replace(/\s+/g, ' ');
    const limit = Math.min(66, Math.floor((this.dashboardSize.width - 240) / 18) * 2 - 4);
    this.status.string = summary.length > limit ? summary.slice(0, limit - 1) + '…' : summary;
    this.status.node.color = color;
  }
}

function nowNs(): number {
  return Date.now() * 1_000_000;
}

function callNativeStatic(...argumentsList: unknown[]): unknown {
  const call = jsb.reflection.callStaticMethod as (...values: unknown[]) => unknown;
  return call(...argumentsList);
}
