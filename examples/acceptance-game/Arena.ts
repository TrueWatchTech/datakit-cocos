// Pure game rules, shared by Creator rendering and deterministic smoke tests.
export type Point = {
    x: number;
    y: number;
};
export type Enemy = Point & {
    id: number;
    hp: number;
    maxHp: number;
    speed: number;
    boss: boolean;
};
export type Bullet = Point & {
    id: number;
    vx: number;
    vy: number;
    life: number;
};
export type Crystal = Point & {
    id: number;
};
export type ArenaEvent = {
    name: string;
    value?: number;
};
export const obstacles = [{ x: -155, y: 30, w: 90, h: 44 }, { x: 150, y: -45, w: 90, h: 44 }, { x: 0, y: 132, w: 92, h: 34 }];
export function distance(a: Point, b: Point) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
export class Arena {
    player: Point = { x: 0, y: -90 };
    hp = 100;
    energy = 100;
    kills = 0;
    crystals = 0;
    elapsed = 0;
    wave = 0;
    status: 'playing' | 'won' | 'lost' = 'playing';
    paused = false;
    firing = false;
    move: Point = { x: 0, y: 0 };
    enemies: Enemy[] = [];
    bullets: Bullet[] = [];
    drops: Crystal[] = [];
    events: ArenaEvent[] = [];
    dashCooldown = 0;
    healCooldown = 0;
    invincible = 0;
    facing: Point = { x: 0, y: 1 };
    private seed: number;
    private id = 0;
    private spawnLeft = 0;
    private spawnTimer = 0;
    private waveDelay = 1.4;
    private shotTimer = 0;
    private hurtTimer = 0;
    stage: number;
    weapon: number;
    constructor(stage: number, weapon: number, seed = 249) { this.stage = stage; this.weapon = weapon; this.seed = seed; }
    private random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
    private emit(name: string, value?: number) { this.events.push({ name, value }); }
    drain() { const out = this.events; this.events = []; return out; }
    private blocked(x: number, y: number, r: number) { return obstacles.some(o => Math.abs(x - o.x) < o.w / 2 + r && Math.abs(y - o.y) < o.h / 2 + r); }
    private movePoint(p: Point, dx: number, dy: number, r: number) {
        const x = Math.max(-405 + r, Math.min(405 - r, p.x + dx));
        if (!this.blocked(x, p.y, r))
            p.x = x;
        const y = Math.max(-155 + r, Math.min(190 - r, p.y + dy));
        if (!this.blocked(p.x, y, r))
            p.y = y;
    }
    dash() {
        if (this.paused || this.status !== 'playing' || this.dashCooldown > 0)
            return false;
        const len = Math.sqrt(this.move.x * this.move.x + this.move.y * this.move.y);
        const d = len > 0 ? { x: this.move.x / len, y: this.move.y / len } : this.facing;
        for (let n = 0; n < 12; n++)
            this.movePoint(this.player, d.x * 9, d.y * 9, 12);
        this.dashCooldown = 4;
        this.invincible = .55;
        this.emit('dash');
        return true;
    }
    heal() {
        if (this.paused || this.status !== 'playing' || this.healCooldown > 0 || this.hp >= 100)
            return false;
        this.hp = Math.min(100, this.hp + 35);
        this.healCooldown = 12;
        this.emit('repair', this.hp);
        return true;
    }
    pause(value: boolean) { this.paused = value; this.firing = false; this.move = { x: 0, y: 0 }; this.emit(value ? 'pause' : 'resume'); }
    trigger() {
        if (!this.paused && this.status === 'playing' && this.shotTimer <= 0 && this.energy >= 7) {
            const target = this.enemies.slice().sort((a, b) => distance(a, this.player) - distance(b, this.player))[0];
            let d = this.facing;
            if (target) {
                const len = distance(target, this.player) || 1;
                d = { x: (target.x - this.player.x) / len, y: (target.y - this.player.y) / len };
            }
            this.bullets.push({ id: ++this.id, x: this.player.x + d.x * 20, y: this.player.y + d.y * 20, vx: d.x * 520, vy: d.y * 520, life: 1.6 });
            this.emit('shot');
            this.energy -= 7;
            this.shotTimer = this.weapon === 1 ? .16 : .23;
        }
    }
    tick(delta: number) {
        if (this.paused || this.status !== 'playing')
            return;
        const dt = Math.min(.05, Math.max(0, delta));
        this.elapsed += dt;
        this.dashCooldown = Math.max(0, this.dashCooldown - dt);
        this.healCooldown = Math.max(0, this.healCooldown - dt);
        this.invincible = Math.max(0, this.invincible - dt);
        this.hurtTimer -= dt;
        this.shotTimer -= dt;
        this.energy = Math.min(100, this.energy + dt * 20);
        const len = Math.sqrt(this.move.x * this.move.x + this.move.y * this.move.y);
        if (len > .05) {
            const scale = Math.max(1, len);
            this.facing = { x: this.move.x / len, y: this.move.y / len };
            this.movePoint(this.player, this.move.x / scale * 172 * dt, this.move.y / scale * 172 * dt, 12);
        }
        if (!this.enemies.length && !this.spawnLeft) {
            if (this.wave === 3) {
                this.status = 'won';
                this.emit('victory', this.kills);
                return;
            }
            this.waveDelay -= dt;
            if (this.waveDelay <= 0) {
                this.wave++;
                this.spawnLeft = 3 + this.wave + this.stage;
                this.spawnTimer = .2;
                this.waveDelay = 1.6;
                this.emit('wave_start', this.wave);
            }
        }
        if (this.spawnLeft > 0) {
            this.spawnTimer -= dt;
            if (this.spawnTimer <= 0) {
                this.spawnLeft--;
                this.spawnTimer = .75;
                const side = this.random() > .5 ? 1 : -1;
                const boss = this.wave === 3 && this.spawnLeft === 0;
                const hp = boss ? 12 + this.stage * 4 : 2 + this.stage;
                this.enemies.push({ id: ++this.id, x: side * 370, y: -120 + this.random() * 280, hp, maxHp: hp, speed: boss ? 37 : 48 + this.stage * 9, boss });
            }
        }
        if (this.firing)
            this.trigger();
        for (const e of this.enemies) {
            const d = distance(e, this.player) || 1;
            this.movePoint(e, (this.player.x - e.x) / d * e.speed * dt, (this.player.y - e.y) / d * e.speed * dt, e.boss ? 20 : 13);
            if (distance(e, this.player) < (e.boss ? 37 : 27) && this.hurtTimer <= 0 && this.invincible <= 0) {
                this.hp -= e.boss ? 18 : 10;
                this.hurtTimer = .8;
                this.emit('damage', this.hp);
            }
        }
        for (const b of this.bullets) {
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.life -= dt;
            if (this.blocked(b.x, b.y, 2))
                b.life = 0;
            if (b.life > 0) {
                const e = this.enemies.find(e => e.hp > 0 && distance(e, b) < (e.boss ? 26 : 18));
                if (e) {
                    e.hp -= this.weapon === 1 ? 1 : 2;
                    b.life = 0;
                    if (e.hp <= 0) {
                        this.kills++;
                        this.drops.push({ id: ++this.id, x: e.x, y: e.y });
                        this.emit(e.boss ? 'boss_defeated' : 'enemy_defeated', this.kills);
                    }
                }
            }
        }
        this.enemies = this.enemies.filter(e => e.hp > 0);
        this.bullets = this.bullets.filter(b => b.life > 0 && Math.abs(b.x) < 430 && Math.abs(b.y) < 220);
        this.drops = this.drops.filter(c => { const d = distance(c, this.player); if (d < 75) {
            c.x += (this.player.x - c.x) * dt * 6;
            c.y += (this.player.y - c.y) * dt * 6;
        } if (d < 22) {
            this.crystals++;
            this.emit('crystal_collected', this.crystals);
            return false;
        } return true; });
        if (this.hp <= 0) {
            this.hp = 0;
            this.status = 'lost';
            this.emit('defeat', this.kills);
        }
    }
}
