import { _decorator, Component, Node, Color, Graphics, Label, Button, UITransform, UIOpacity, BlockInputEvents, Layers, Camera, Vec3, EventTouch, EventKeyboard, input, Input, Game, game, sys, resources, AudioClip, AudioSource, profiler } from 'cc';
import { StarportGame } from './acceptance-game/StarportGame';
import { GameUI, GameNode, GameColor, GameCallbacks } from './acceptance-game/GameUI';

const { ccclass } = _decorator;
/** Engine adapter only; gameplay, layouts and telemetry names are shared. */
@ccclass('StarportScene')
export class StarportScene extends Component {
  private gameController?: StarportGame;
  private clips: Record<string, AudioClip> = {};
  private lastShot = 0;
  private restoreStats = false;
  private audio?: AudioSource;
  initialize(callbacks: GameCallbacks, camera: Camera): void {
    // Keep the debug overlay off the joystick; restore it on the acceptance home.
    this.restoreStats = profiler.isShowingStats(); profiler.hideStats();
    this.audio = this.node.addComponent(AudioSource);
    const engineNode = (value: GameNode): Node => value as Node;
    const engineColor = (value: GameColor): Color => value as Color;
    const node = (parent: GameNode, name: string): Node => {
      const child = new Node(name);
      child.layer = Layers.Enum.UI_2D;
      engineNode(parent).addChild(child);
      return child;
    };
    const size = (target: Node, w: number, h: number): void => {
      (target.getComponent(UITransform) || target.addComponent(UITransform)).setContentSize(w, h);
    };
    let resetJoystick: (() => void) | undefined;
    const ui: GameUI = {
      resetInput: () => { resetJoystick?.(); },
      color: (r, g, b, a = 255) => new Color(r, g, b, a),
      node,
      graphics: (parent, name) => node(parent, name).addComponent(Graphics),
      box: (parent, name, x, y, w, h, color, radius) => {
        const target = node(parent, name);
        target.setPosition(x, y);size(target, w, h);
        const graphics = target.addComponent(Graphics);graphics.fillColor = engineColor(color);
        graphics.roundRect(-w / 2, -h / 2, w, h, radius);graphics.fill();return target;
      },
      label: (parent, text, x, y, w, h, fontSize, color) => {
        const target = node(parent, 'Text');target.setPosition(x, y);
        const label = target.addComponent(Label);label.useSystemFont = true;label.fontFamily = 'Arial';
        label.overflow = Label.Overflow.CLAMP;size(target, w, h);
        label.string = text;label.fontSize = fontSize;label.lineHeight = Math.ceil(fontSize * 1.3);
        label.color = engineColor(color);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;label.verticalAlign = Label.VerticalAlign.CENTER;
        return label;
      },
      button: (parent, name, text, x, y, w, h, click, bg, fg) => {
        const target = engineNode(ui.box(parent, name, x, y, w, h, bg, 8));
        const button = target.addComponent(Button);button.transition = Button.Transition.SCALE;button.zoomScale = .95;
        target.on(Button.EventType.CLICK, click);
        if(text)ui.label(target, text, 0, 0, w - 10, h - 4, 17, fg);return target;
      },
      joystick: (target, move, end) => {
        const targetNode = engineNode(target);
        let owner: number | undefined;
        resetJoystick = () => { owner = undefined; end(); };
        const update = (event: EventTouch, started: boolean): void => {
          if(started){if(owner !== undefined)return;owner=event.getID();}
          if(owner !== event.getID())return;
          // Match UI hit testing: screen pixels -> display-camera world -> joystick local.
          // UI location is not world space when the camera is centered or zoomed.
          const location = event.getLocation();
          const world = camera.screenToWorld(new Vec3(location.x, location.y, 0));
          const point = targetNode.getComponent(UITransform)!.convertToNodeSpaceAR(world);
          move({x:point.x,y:point.y}, started);
        };
        targetNode.on(Node.EventType.TOUCH_START, (event: EventTouch) => update(event, true));
        targetNode.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => update(event, false));
        const release = (event: EventTouch): void => {if(owner === event.getID()){owner=undefined;end();}};
        targetNode.on(Node.EventType.TOUCH_END, release);targetNode.on(Node.EventType.TOUCH_CANCEL, release);
      },
      hold: (target, start, end) => {
        const targetNode = engineNode(target);
        targetNode.on(Node.EventType.TOUCH_START, start);targetNode.on(Node.EventType.TOUCH_END, end);targetNode.on(Node.EventType.TOUCH_CANCEL, end);
      },
      block: target => {engineNode(target).addComponent(BlockInputEvents);},
      opacity: (target, value) => { (engineNode(target).getComponent(UIOpacity) || engineNode(target).addComponent(UIOpacity)).opacity = value; },
      sound: name => {
        const clip = this.clips[name];if(!clip)return;
        if(name === 'shoot'){if(Date.now() - this.lastShot < 140)return;this.lastShot=Date.now();}
        this.audio?.playOneShot(clip);
      },
      load: key => sys.localStorage.getItem(key),
      save: (key, value) => {try{sys.localStorage.setItem(key, value);}catch(_error){}},
    };
    this.gameController = new StarportGame(ui, this.node, callbacks);
    resources.loadDir('starport-sfx', AudioClip, (error, clips: AudioClip[]) => {
      if(!error && this.isValid)clips.forEach(clip => this.clips[clip.name] = clip);
    });
    input.on(Input.EventType.KEY_DOWN, this.keyDown, this);
    input.on(Input.EventType.KEY_UP, this.keyUp, this);
    game.on(Game.EVENT_HIDE, this.background, this);
  }
  update(dt: number): void {this.gameController?.update(dt);}
  private keyDown(event: EventKeyboard): void {this.gameController?.keyDown(event.keyCode);}
  private keyUp(event: EventKeyboard): void {this.gameController?.keyUp(event.keyCode);}
  private background(): void {this.gameController?.background();}
  onDestroy(): void {
    if (this.restoreStats) profiler.showStats();
    input.off(Input.EventType.KEY_DOWN, this.keyDown, this);
    input.off(Input.EventType.KEY_UP, this.keyUp, this);
    game.off(Game.EVENT_HIDE, this.background, this);
    this.gameController?.dispose();this.gameController=undefined;
  }
}
