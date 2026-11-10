import { SampleDashboard, dashboardViewport, statusPages, DashboardAction, DashboardViewport } from './acceptance-components/SampleDashboard';
import { WebViewValidationScene } from './WebViewValidationScene';
import { ReplayEvidenceScene } from './ReplayEvidenceScene';
import { ReplayPostProcessScene } from './ReplayPostProcessScene';
import { ReplayOptionalScene } from './ReplayOptionalScene';
import { ReplayRigScene } from './ReplayRigScene';
import { ReplayGeometryScene } from './ReplayGeometryScene';
import { ReplaySupportScene } from './ReplaySupportScene';
import { ReplayRenderScene } from './ReplayRenderScene';
import { ReplayAssetScene } from './ReplayAssetScene';
import { ReplayMotionScene } from './ReplayMotionScene';
import { ReplayEffectsScene } from './ReplayEffectsScene';
import { ReplayLayoutScene } from './ReplayLayoutScene';
import { ReplayScrollScene } from './ReplayScrollScene';
import { ReplayBasicScene } from './ReplayBasicScene';
import { ReplayInputScene } from './ReplayInputScene';
import { StarportScene } from './StarportScene';
import ReplayPrivacy, { ReplayPrivacyMode } from './truewatch-cocos-sdk/ReplayPrivacy';
import { Replay3DScene } from './Replay3DScene';
import {
  _decorator,
  Button,
  BlockInputEvents,
  Camera,
  Director,
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
  profiler,
  sys,
  view,
} from 'cc';
import { truewatchSdk as baseSdk } from '@truewatchtech/cocos-sdk/creator3';
import { withSessionReplay } from '@truewatchtech/cocos-session-replay/creator3';

let truewatchSdk: ReturnType<typeof withSessionReplay>;

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
    if (sys.isNative) truewatchSdk = withSessionReplay(baseSdk);
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
  private dashboard = new SampleDashboard(3);
  private dashboardSize: DashboardViewport = { width: 960, height: 640, compact: false };
  private privacyPage = false;
  private lastStatus = 'Ready to test';
  private lastStatusColor = COLORS.muted;
  private detailsNode?: Node;
  private inputCoverageNode?: Node;
  private sampleRoot?: Node;
  private gameNode?: Node;
  private status?: Label;
  private replayCard?: Graphics;
  private privacyMaskProbe?: Node;
  private privacyProbeGroup?: Node;
  private privacyLayoutMoved = false;
  private replayState = 0;
  private maskShowAll = true;
  private resourceSequence = 0;
  private entered = false;
  private waitingForNativeReturn = false;
  private untrackedXhr?: UntrackedXhrMethods;
  private sampleCamera?: Camera;
  private sampleCanvas?: Node;
  private replay3D?: Replay3DScene;
  private postProcessScene?: ReplayPostProcessScene;
  private panelRedraws:Array<()=>void>=[];

  start(): void {
    const { root, camera } = this.createScene();
    profiler?.hideStats();
    this.sampleCamera = camera;
    this.sampleCanvas = root.parent!;
    truewatchSdk?.setReplayCamera(camera);
    this.sampleRoot = root;
    this.render(root);
    view.on('canvas-resize', this.refreshDashboardSize, this);

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
    if (!sys.isNative) { this.setStatus('Telemetry controls require an Android or iOS build.', COLORS.warning); return; }
    const attributes = { ...ATTRIBUTES, button: 'rum_log', emitted_at: Date.now() };
    truewatchSdk.rum.addAction('rum_log_clicked', 'click', attributes);
    truewatchSdk.logger.log('Creator 3 sample emitted a RUM Action and linked Log', 'info', attributes);
    this.setStatus('RUM Action + linked Log emitted', COLORS.primary);
  }

  private emitAutomaticResource(): void {
    if (!sys.isNative) { this.setStatus('Telemetry controls require an Android or iOS build.', COLORS.warning); return; }
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
    if (!sys.isNative) { this.setStatus('Telemetry controls require an Android or iOS build.', COLORS.warning); return; }
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
    if (!sys.isNative) { this.setStatus('Telemetry controls require an Android or iOS build.', COLORS.warning); return; }
    const error = new Error('Creator 3 Hybrid sample diagnostic error');
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
    const scenario = this.maskShowAll ? 'show_all' : 'fixed_height';
    view.setDesignResolutionSize(960, 640, this.maskShowAll ? ResolutionPolicy.SHOW_ALL : ResolutionPolicy.FIXED_HEIGHT);
    if (this.entered) truewatchSdk.rum.addAction('mask_fit_changed', 'click', { ...ATTRIBUTES, mask_scenario: scenario });
    this.setStatus(`Mask verification: ${scenario} · private token must stay gray in Replay`, COLORS.primary);
  }

  private togglePrivacyLayout(): void {
    this.privacyLayoutMoved = !this.privacyLayoutMoved;
    const group = this.privacyProbeGroup;
    if (!group) return;
    const scale = this.privacyLayoutMoved ? 0.85 : 1;
    group.setPosition(this.privacyLayoutMoved ? 36 : 0, this.privacyLayoutMoved ? 82 : 95);
    group.setScale(scale, scale, 1);
    this.setStatus('Privacy layout changed: only the three red targets should be masked in Replay', COLORS.primary);
  }

  private openNativePage(): void {
    if (!sys.isNative) { this.setStatus('Native page requires an Android or iOS build.', COLORS.warning); return; }
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

  private setSampleViewport(width: number, height: number, showAll = true): void {
    if (!this.sampleRoot) return;
    this.sampleRoot.getComponent(UITransform)!.setContentSize(width, height);
    this.sampleRoot.parent!.getComponent(UITransform)!.setContentSize(width, height);
    if (this.sampleCamera) this.sampleCamera.orthoHeight = height / 2;
    view.setDesignResolutionSize(width, height, !showAll ? ResolutionPolicy.FIXED_HEIGHT : ResolutionPolicy.SHOW_ALL);
  }

  private refreshDashboardSize(): void {
    if (!this.sampleRoot?.activeInHierarchy || this.privacyPage || !this.sampleCanvas?.activeInHierarchy) return;
    const frame = view.getFrameSize();
    const next = dashboardViewport(frame.width, frame.height);
    if (next.width !== this.dashboardSize.width || next.height !== this.dashboardSize.height) this.render(this.sampleRoot);
  }

  private render(root: Node): void {
    if (this.privacyMaskProbe) truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe, 'unmask');
    root.children.slice().forEach(child => { child.active = false; child.destroy(); });
    this.detailsNode = undefined;
    this.privacyMaskProbe = undefined;
    this.privacyProbeGroup = undefined;
    this.replayCard = undefined;
    this.panelRedraws = [];
    const frame = view.getFrameSize();
    this.dashboardSize = this.privacyPage ? { width: 960, height: 640, compact: false } : dashboardViewport(frame.width, frame.height);
    const { width, height } = this.dashboardSize;
    this.setSampleViewport(width, height, !this.privacyPage || this.maskShowAll);
    this.panel(root, 'Background', 0, 0, width, height, COLORS.background);
    this.label(root, 'Cocos Sample', -width / 2 + 136, height / 2 - 44, 224, 48, width < 640 ? 26 : 30, COLORS.text);
    if (width > 640) this.label(root, 'Creator 3', 16, height / 2 - 44, 170, 36, 20, COLORS.primary);
    this.button(root, 'NativePage', 'Native page', width / 2 - 112, height / 2 - 44, 176, 56, () => this.openNativePage(), COLORS.info);

    if (this.privacyPage) {
      this.renderPrivacy(root);
    } else {
      this.dashboard.render({
        label: (text, x, y, w, h, size, tone) => { this.label(root, text, x, y, w, h, size, COLORS[tone]); },
        button: (name, text, x, y, w, h, click, tone) => this.button(root, name, text, x, y, w, h, click, COLORS[tone]),
        card: (entry, x, y, w, h, click) => {
          const card = this.panel(root, entry.id, x, y, w, h, COLORS.panel);
          card.addComponent(Button).transition = Button.Transition.NONE;
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
    // Old page Graphics are destroyed at the end of the frame; refresh the new
    // page afterwards so native shared-buffer reuse cannot erase its cards.
    director.once(Director.EVENT_AFTER_DRAW, () => this.panelRedraws.forEach(redraw => redraw()));
  }

  private openPrivacy(): void {
    if (!this.sampleRoot) return;
    this.privacyPage = true;
    this.privacyLayoutMoved = false;
    this.replayState = 0;
    this.render(this.sampleRoot);
  }

  private renderPrivacy(root: Node): void {
    this.button(root, 'BackToCategories', '‹ Categories', -350, 208, 212, 56, () => {
      this.privacyPage = false;
      this.render(root);
    }, COLORS.panel);
    this.label(root, 'Replay & privacy', 100, 208, 420, 40, 26, COLORS.text);
    const replayNode = this.panel(root, 'ReplayVisualState', 0, 95, 720, 140, COLORS.panel);
    this.privacyProbeGroup = replayNode;
    this.replayCard = replayNode.getComponent(Graphics) || undefined;
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
      case 'RenderCoverage': void this.openCoverage('render'); break;
      case 'SupportCoverage': void this.openCoverage('support'); break;
      case 'GeometryCoverage': void this.openCoverage('geometry'); break;
      case 'RigCoverage': void this.openCoverage('rig'); break;
      case 'OptionalCoverage': void this.openCoverage('optional'); break;
      case 'Replay3D': void this.open3DScene(); break;
      case 'LightCoverage': void this.open3DScene(true); break;
      case 'PostProcessCoverage': void this.openPostProcessScene(); break;
    }
  }

  private showStatusDetails(): void {
    if (!this.sampleRoot || this.detailsNode) return;
    const { width, height } = this.dashboardSize;
    const redrawCount = this.panelRedraws.length;
    const overlay = this.panel(this.sampleRoot, 'StatusDetailOverlay', 0, 0, width, height, COLORS.background);
    this.detailsNode = overlay;
    overlay.addComponent(BlockInputEvents);
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
      this.panelRedraws.splice(redrawCount);
      this.detailsNode = undefined;
      // Destroying native Graphics can invalidate shared buffers of the page
      // underneath. Re-upload after the overlay's deferred destruction.
      director.once(Director.EVENT_AFTER_DRAW, () => this.panelRedraws.forEach(redraw => redraw()));
    }, COLORS.info);
  }

  private async openPostProcessScene():Promise<void> {
    if(this.postProcessScene||!this.sampleCamera||!this.sampleCanvas)return;
    this.setSampleViewport(960, 640);
    // Select an explicit disabled source to suspend GPU captures during the
    // device-only control. The visible scene and Hybrid ownership stay active.
    const probeNode=new Node('PostCaptureDisabledSource');director.getScene()!.addChild(probeNode);const disabledSource=probeNode.addComponent(Camera);disabledSource.enabled=false;truewatchSdk?.setReplayCamera(disabledSource);
    this.sampleCamera.enabled=false;this.sampleCanvas.active=false;
    if(this.privacyMaskProbe)truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe,'unmask');
    const node=new Node('ReplayPostProcessValidation');director.getScene()!.addChild(node);this.postProcessScene=node.addComponent(ReplayPostProcessScene);
    const restore=()=>{truewatchSdk?.setReplayCamera(this.sampleCamera);this.sampleCamera!.enabled=true;this.sampleCanvas!.active=true;this.render(this.sampleRoot!);director.once(Director.EVENT_AFTER_DRAW,()=>this.panelRedraws.forEach(redraw=>redraw()));if(this.privacyMaskProbe)truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe,'mask');node.active=false;node.destroy();probeNode.destroy();this.postProcessScene=undefined;};
    try{await this.postProcessScene.initialize(restore,(component,stage)=>{if(this.entered)truewatchSdk.rum.addAction('replay_postprocess_case','custom',{...ATTRIBUTES,component,stage});},enabled=>truewatchSdk?.setReplayCamera(enabled?this.postProcessScene!.camera:disabledSource));}catch(error){restore();this.setStatus(`Unable to open post effects: ${String(error)}`,COLORS.danger);}
  }

  private async open3DScene(lightCoverage = false): Promise<void> {
    if (this.replay3D || !this.sampleCamera || !this.sampleCanvas) return;
    this.setSampleViewport(960, 640);
    this.sampleCamera.enabled = false;
    this.sampleCanvas.active = false;
    if (this.privacyMaskProbe) truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe, 'unmask');
    const node = new Node('Replay3DValidation');
    director.getScene()!.addChild(node);
    this.replay3D = node.addComponent(Replay3DScene);
    const restore = (): void => {
      truewatchSdk?.setReplayCamera(this.sampleCamera);
      this.sampleCamera!.enabled = true;
      this.sampleCanvas!.active = true;
      this.render(this.sampleRoot!);
      if (this.privacyMaskProbe) truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe, 'mask');
      node.active = false;
      node.destroy();
      this.replay3D = undefined;
    };
    try {
      await this.replay3D.initialize(restore, lightCoverage, state => {
        if (this.entered) truewatchSdk.rum.addAction('replay_light_coverage', 'click', { ...ATTRIBUTES, state });
      });
      truewatchSdk?.setReplayCamera(this.replay3D.camera);
      if (this.entered) truewatchSdk.rum.addAction('replay_3d_scene_opened', 'click', ATTRIBUTES);
    } catch (error) {
      restore();
      this.setStatus(`Unable to load 3D scene: ${String(error)}`, COLORS.danger);
      console.error('[HybridTelemetrySample] Unable to load 3D scene', error);
    }
  }

  private async openCoverage(kind: 'webview' | 'input' | 'basic' | 'scroll' | 'layout' | 'effects' | 'motion' | 'assets' | 'render' | 'support' | 'geometry' | 'rig' | 'optional' | 'evidence'): Promise<void> {
    if (this.inputCoverageNode || !this.sampleRoot) return;
    const sampleRoot = this.sampleRoot;
    this.setSampleViewport(960, 640);
    sampleRoot.active = false;
    if (this.privacyMaskProbe) truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe, 'unmask');
    const node = new Node('ReplayCoverage');
    node.layer = Layers.Enum.UI_2D;
    sampleRoot.parent!.addChild(node);
    this.inputCoverageNode = node;
    const restore = (): void => {
      if (this.inputCoverageNode !== node) return;
      this.inputCoverageNode = undefined;
      node.active = false;
      node.destroy();
      this.privacyLayoutMoved = false;
      this.replayState = 0;
      sampleRoot.active = true;
      this.render(sampleRoot);
      this.setStatus('Coverage closed · reopen to verify fresh state', COLORS.primary);
      truewatchSdk?.setReplayCamera(this.sampleCamera);
      if (this.entered) { truewatchSdk.rum.stopView(); truewatchSdk.rum.startView(VIEW_NAME, ATTRIBUTES); }
    };
    try {
      if (this.entered) { truewatchSdk.rum.stopView(); truewatchSdk.rum.startView(kind === 'webview' ? 'WebView/Validation' : kind === 'input' ? 'Replay/InputCoverage' : kind === 'basic' ? 'Replay/BasicCoverage' : kind === 'scroll' ? 'Replay/ScrollCoverage' : kind === 'layout' ? 'Replay/LayoutCoverage' : kind === 'effects' ? 'Replay/EffectsCoverage' : kind === 'motion' ? 'Replay/MotionCoverage' : kind === 'render' ? 'Replay/RenderCoverage' : kind === 'support' ? 'Replay/SupportCoverage' : kind === 'geometry' ? 'Replay/GeometryCoverage' : kind === 'rig' ? 'Replay/RigCoverage' : kind === 'optional' ? 'Replay/OptionalCoverage' : 'Replay/AssetCoverage', ATTRIBUTES); }
      const scene = kind === 'webview' ? node.addComponent(WebViewValidationScene) : kind === 'evidence' ? node.addComponent(ReplayEvidenceScene) : kind === 'input' ? node.addComponent(ReplayInputScene) : kind === 'basic' ? node.addComponent(ReplayBasicScene) : kind === 'scroll' ? node.addComponent(ReplayScrollScene) : kind === 'layout' ? node.addComponent(ReplayLayoutScene) : kind === 'effects' ? node.addComponent(ReplayEffectsScene) : kind === 'motion' ? node.addComponent(ReplayMotionScene) : kind === 'render' ? node.addComponent(ReplayRenderScene) : kind === 'support' ? node.addComponent(ReplaySupportScene) : kind === 'geometry' ? node.addComponent(ReplayGeometryScene) : kind === 'rig' ? node.addComponent(ReplayRigScene) : kind === 'optional' ? node.addComponent(ReplayOptionalScene) : node.addComponent(ReplayAssetScene);
      await scene.initialize(restore, (caseId: string, stage: string) => {
        if (!this.entered) return;
        // Only fixed case identifiers and phases leave this page; never forward input payloads.
        truewatchSdk.rum.addAction(`replay_${kind}_case`, 'custom', { ...ATTRIBUTES, case_id: caseId, stage });
      });
    } catch (error) { restore(); this.setStatus(`Unable to open coverage: ${String(error)}`, COLORS.danger); }
  }

  private openGame(): void {
    if (this.gameNode || !this.sampleRoot) return;
    const sampleRoot = this.sampleRoot;
    // The shared game uses the same screen camera, so HUD and gameplay are captured together.
    this.setSampleViewport(960, 640);
    sampleRoot.active = false;
    if (this.privacyMaskProbe) truewatchSdk?.replay.setPrivacy(this.privacyMaskProbe, 'unmask');
    const node = new Node('StarportGame');
    node.layer = Layers.Enum.UI_2D;
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
      truewatchSdk?.setReplayCamera(this.sampleCamera);
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
      }, this.sampleCamera!);
    } catch (error) { restore(); this.setStatus(`Unable to open game: ${String(error)}`, COLORS.danger); }
  }

  private panel(parent: Node, name: string, x: number, y: number, width: number, height: number, color: Color, square = false): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = color;
    const redraw=()=>{
      if (!graphics.isValid || !graphics.node.activeInHierarchy) return;
      graphics.clear();
      if (square) graphics.rect(-width / 2, -height / 2, width, height);
      else graphics.roundRect(-width / 2, -height / 2, width, height, Math.min(18, height / 4));
      graphics.fill();
    };
    redraw();
    this.panelRedraws.push(redraw);
    return node;
  }

  private button(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, onClick: () => void, color: Color): void {
    const node = this.panel(parent, name, x, y, width, height, color);
    node.addComponent(Button).transition = Button.Transition.NONE;
    node.on(Button.EventType.CLICK, onClick);
    this.label(node, text, 0, 0, width - 24, height - 8, 20, color === COLORS.primary ? COLORS.background : COLORS.text);
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
    label.overflow = Label.Overflow.CLAMP;
    return label;
  }

  private setStatus(text: string, color: Color): void {
    this.lastStatus = text;
    this.lastStatusColor = color;
    if (!this.status?.node.isValid) return;
    const summary = text.replace(/\s+/g, ' ');
    const limit = Math.min(66, Math.floor((this.dashboardSize.width - 240) / 18) * 2 - 4);
    this.status.string = summary.length > limit ? summary.slice(0, limit - 1) + '…' : summary;
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
