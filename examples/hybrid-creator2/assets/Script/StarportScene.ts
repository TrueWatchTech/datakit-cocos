import { StarportGame } from '../acceptance-game/StarportGame';
import { GameUI, GameNode, GameColor, GameCallbacks } from '../acceptance-game/GameUI';

const { ccclass } = cc._decorator;
/** Engine adapter only; gameplay, layouts and telemetry names are shared. */
@ccclass('StarportScene')
export default class StarportScene extends cc.Component {
  private gameController?: StarportGame;
  private clips: Record<string, cc.AudioClip> = {};
  private lastShot = 0;
  private restoreStats = false;

  initialize(callbacks: GameCallbacks, camera: cc.Camera): void {
    // Keep the debug overlay off the joystick; restore it on the acceptance home.
    this.restoreStats = cc.debug.isDisplayStats(); cc.debug.setDisplayStats(false);

    const engineNode = (value: GameNode): cc.Node => value as cc.Node;
    const engineColor = (value: GameColor): cc.Color => value as cc.Color;
    const node = (parent: GameNode, name: string): cc.Node => {
      const child = new cc.Node(name);

      engineNode(parent).addChild(child);
      return child;
    };
    const size = (target: cc.Node, w: number, h: number): void => {
      target.setContentSize(w, h);
    };
    let resetJoystick: (() => void) | undefined;
    const ui: GameUI = {
      resetInput: () => { resetJoystick?.(); },
      color: (r, g, b, a = 255) => new cc.Color(r, g, b, a),
      node,
      graphics: (parent, name) => node(parent, name).addComponent(cc.Graphics),
      box: (parent, name, x, y, w, h, color, radius) => {
        const target = node(parent, name);
        target.setPosition(x, y);size(target, w, h);
        const graphics = target.addComponent(cc.Graphics);graphics.fillColor = engineColor(color);
        graphics.roundRect(-w / 2, -h / 2, w, h, radius);graphics.fill();return target;
      },
      label: (parent, text, x, y, w, h, fontSize, color) => {
        const target = node(parent, 'Text');target.setPosition(x, y);
        const label = target.addComponent(cc.Label);label.useSystemFont = true;label.fontFamily = 'Arial';
        label.overflow = cc.Label.Overflow.CLAMP;size(target, w, h);
        label.string = text;label.fontSize = fontSize;label.lineHeight = Math.ceil(fontSize * 1.3);
        target.color = engineColor(color);
        label.horizontalAlign = cc.Label.HorizontalAlign.CENTER;label.verticalAlign = cc.Label.VerticalAlign.CENTER;
        return label;
      },
      button: (parent, name, text, x, y, w, h, click, bg, fg) => {
        const target = engineNode(ui.box(parent, name, x, y, w, h, bg, 8));
        const button = target.addComponent(cc.Button);button.transition = cc.Button.Transition.SCALE;button.zoomScale = .95;
        target.on('click', click);
        if(text)ui.label(target, text, 0, 0, w - 10, h - 4, 17, fg);return target;
      },
      joystick: (target, move, end) => {
        const targetNode = engineNode(target);
        let owner: number | undefined;
        resetJoystick = () => { owner = undefined; end(); };
        const update = (event: cc.Event.EventTouch, started: boolean): void => {
          if(started){if(owner !== undefined)return;owner=event.getID();}
          if(owner !== event.getID())return;
          const location = event.getLocation();
          // Use the display camera, matching the engine's touch hit-test conversion.
          const world = camera.getScreenToWorldPoint(location);
          const point = targetNode.convertToNodeSpaceAR(cc.v2(world.x, world.y));
          move({x:point.x,y:point.y}, started);
        };
        targetNode.on(cc.Node.EventType.TOUCH_START, (event: cc.Event.EventTouch) => update(event, true));
        targetNode.on(cc.Node.EventType.TOUCH_MOVE, (event: cc.Event.EventTouch) => update(event, false));
        const release = (event: cc.Event.EventTouch): void => {if(owner === event.getID()){owner=undefined;end();}};
        targetNode.on(cc.Node.EventType.TOUCH_END, release);targetNode.on(cc.Node.EventType.TOUCH_CANCEL, release);
      },
      hold: (target, start, end) => {
        const targetNode = engineNode(target);
        targetNode.on(cc.Node.EventType.TOUCH_START, start);targetNode.on(cc.Node.EventType.TOUCH_END, end);targetNode.on(cc.Node.EventType.TOUCH_CANCEL, end);
      },
      block: target => {engineNode(target).addComponent(cc.BlockInputEvents);},
      opacity: (target, value) => { engineNode(target).opacity = value; },
      sound: name => {
        const clip = this.clips[name];if(!clip)return;
        if(name === 'shoot'){if(Date.now() - this.lastShot < 140)return;this.lastShot=Date.now();}
        cc.audioEngine.playEffect(clip, false);
      },
      load: key => cc.sys.localStorage.getItem(key),
      save: (key, value) => {try{cc.sys.localStorage.setItem(key, value);}catch(_error){}},
    };
    this.gameController = new StarportGame(ui, this.node, callbacks);
    cc.loader.loadResDir('starport-sfx', cc.AudioClip, (error, clips: cc.AudioClip[]) => {
      if(!error && this.isValid)clips.forEach(clip => this.clips[clip.name] = clip);
    });
    cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.keyDown, this);
    cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.keyUp, this);
    cc.game.on(cc.game.EVENT_HIDE, this.background, this);
  }
  update(dt: number): void {this.gameController?.update(dt);}
  private keyDown(event: cc.Event.EventKeyboard): void {this.gameController?.keyDown(event.keyCode);}
  private keyUp(event: cc.Event.EventKeyboard): void {this.gameController?.keyUp(event.keyCode);}
  private background(): void {this.gameController?.background();}
  onDestroy(): void {
    if (this.restoreStats) cc.debug.setDisplayStats(true);
    cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.keyDown, this);
    cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.keyUp, this);
    cc.game.off(cc.game.EVENT_HIDE, this.background, this);
    this.gameController?.dispose();this.gameController=undefined;
  }
}
