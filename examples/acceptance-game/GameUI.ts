import { Point } from './Arena';
// Structural ports: common gameplay never imports an engine or starts the SDK.
export interface GameNode {
    active: boolean;
    angle: number;
    setPosition(x: number, y: number): void;
    setScale(x: number, y: number): void;
    destroy(): void;
}
export interface GameColor {
    r: number;
    g: number;
    b: number;
    a: number;
}
export interface GameLabel {
    string: string;
}
export interface GameGraphics {
    fillColor: GameColor;
    strokeColor: GameColor;
    lineWidth: number;
    clear(): void;
    fill(): void;
    stroke(): void;
    close(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    circle(x: number, y: number, r: number): void;
    ellipse(x: number, y: number, rx: number, ry: number): void;
    roundRect(x: number, y: number, w: number, h: number, r: number): void;
}
export interface GameCallbacks {
    page(name: string): void;
    track(action: string, attributes: Record<string, unknown>): void;
    exit(): void;
}
export interface GameUI {
    color(r: number, g: number, b: number, a?: number): GameColor;
    node(parent: GameNode, name: string): GameNode;
    graphics(parent: GameNode, name: string): GameGraphics;
    box(parent: GameNode, name: string, x: number, y: number, w: number, h: number, color: GameColor, radius: number): GameNode;
    label(parent: GameNode, text: string, x: number, y: number, w: number, h: number, size: number, color: GameColor): GameLabel;
    button(parent: GameNode, name: string, text: string, x: number, y: number, w: number, h: number, click: () => void, bg: GameColor, fg: GameColor): GameNode;
    joystick(node: GameNode, move: (point: Point, started: boolean) => void, end: () => void): void;
    hold(node: GameNode, start: () => void, end: () => void): void;
    resetInput(): void;
    block(node: GameNode): void;
    opacity(node: GameNode, value: number): void;
    sound(name: string): void;
    load(key: string): string | null;
    save(key: string, value: string): void;
}
