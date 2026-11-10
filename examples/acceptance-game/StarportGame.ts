import { Arena, obstacles, ArenaEvent, Point } from './Arena';
import { GameUI, GameNode, GameColor, GameGraphics, GameLabel, GameCallbacks } from './GameUI';
const stages = ['Frontier Hangar', 'Cooling Reactor', 'Deep Space Core'];
/** One game and acceptance flow shared by both Creator generations. */
export class StarportGame {
    private root!: GameNode;
    private page = 'Lobby';
    private model: Arena | null = null;
    private overlay: GameNode | null = null;
    private actors: {
        [key: string]: GameNode;
    } = {};
    private arenaRoot!: GameNode;
    private player!: GameNode;
    private hp!: GameGraphics;
    private energy!: GameGraphics;
    private waveLabel!: GameLabel;
    private scoreLabel!: GameLabel;
    private dashLabel!: GameLabel;
    private healLabel!: GameLabel;
    private toastLabel!: GameLabel;
    private stick!: GameNode;
    private knob: GameNode | null = null;
    private touching = false;
    private keys: {
        [key: number]: boolean;
    } = {};
    private finalizing = false;
    private hangarShip: GameNode | null = null;
    private animationTime = 0;
    private runtime = { stage: 0, result: null as null | {
            won: boolean;
            kills: number;
            crystals: number;
            time: number;
            reward: number;
            stage: number;
        } };
    private profile = { coins: 420, best: 0, weapon: 0, sound: true };
    private palette: Record<'bg' | 'panel' | 'line' | 'white' | 'muted' | 'cyan' | 'gold' | 'red' | 'blue', GameColor>;
    constructor(private ui: GameUI, private parent: GameNode, private callbacks: GameCallbacks) {
        this.palette = { bg: ui.color(9, 17, 29), panel: ui.color(19, 34, 51), line: ui.color(39, 67, 85), white: ui.color(225, 241, 244), muted: ui.color(122, 154, 170), cyan: ui.color(71, 224, 213), gold: ui.color(247, 191, 91), red: ui.color(244, 98, 109), blue: ui.color(70, 126, 216) };
        try {
            const saved = JSON.parse(ui.load('starport-acceptance-v1') || 'null');
            if (saved) {
                if (Number.isFinite(saved.coins) && saved.coins >= 0)
                    this.profile.coins = saved.coins;
                if (Number.isFinite(saved.best) && saved.best >= 0)
                    this.profile.best = saved.best;
                this.profile.weapon = saved.weapon === 1 ? 1 : 0;
                this.profile.sound = saved.sound !== false;
            }
        }
        catch (_error) { }
        this.go('Lobby');
    }
    update(dt: number) {
        this.animationTime += dt;
        if (this.hangarShip)
            this.hangarShip.setPosition(-177, -3 + Math.sin(this.animationTime * 2) * 7);
        if (!this.model)
            return;
        if (!this.touching)
            this.model.move = { x: (this.keys[68] || this.keys[39] ? 1 : 0) - (this.keys[65] || this.keys[37] ? 1 : 0), y: (this.keys[87] || this.keys[38] ? 1 : 0) - (this.keys[83] || this.keys[40] ? 1 : 0) };
        this.model.tick(dt);
        this.model.drain().forEach(e => this.gameEvent(e));
        this.drawBattle();
        if (this.model.status !== 'playing' && !this.finalizing) {
            this.finalizing = true;
            this.finish();
        }
    }
    keyDown(code: number) {
        if (this.keys[code])
            return;
        this.keys[code] = true;
        if (!this.model)
            return;
        if (code === 32)
            this.fire(true);
        if (code === 16)
            this.skill('dash');
        if (code === 69)
            this.skill('heal');
        if (code === 27)
            this.pause();
    }
    keyUp(code: number) { this.keys[code] = false; if (code === 32)
        this.fire(false); }
    background() { this.ui.resetInput(); this.keys = {}; this.stickEnd(); if (this.model && !this.model.paused && this.model.status === 'playing')
        this.pause(); }
    dispose() { this.ui.resetInput(); if (this.root) {
        this.root.active = false;
        this.root.destroy();
    } this.model = null; this.keys = {}; }
    private save() { this.ui.save('starport-acceptance-v1', JSON.stringify(this.profile)); }
    private track(action: string, extra: Record<string, unknown> = {}) { this.callbacks.track(action, { game: 'starport', page: this.page, stage: this.runtime.stage + 1, weapon: this.profile.weapon, ...extra }); }
    private go(page: string) {
        this.ui.resetInput();
        if (this.root) {
            this.root.active = false;
            this.root.destroy();
        }
        this.model = null;
        this.overlay = null;
        this.actors = {};
        this.keys = {};
        this.touching = false;
        this.knob = null;
        this.finalizing = false;
        this.hangarShip = null;
        this.page = page;
        this.root = this.ui.node(this.parent, 'Starport' + page);
        this.callbacks.page(page);
        this.track('open_' + page);
        this.render();
    }
    private render() {
        this.box(this.root, 'Background', 0, 0, 1000, 600, this.palette.bg, 0);
        const stars = this.graphics(this.root, 'Starfield');
        for (let i = 0; i < 64; i++) {
            stars.fillColor = i % 3 ? this.palette.line : this.palette.muted;
            stars.circle(((i * 173) % 930) - 465, ((i * 97) % 530) - 265, i % 3 ? 1 : 1.8);
            stars.fill();
        }
        if (this.page === 'Battle') {
            this.battle();
            return;
        }
        this.label(this.root, 'NORTHSTAR  /  TRAINING DIVISION', -233, 236, 430, 24, 12, this.palette.muted);
        this.label(this.root, '◈  ' + this.profile.coins, 245, 235, 150, 32, 20, this.palette.gold);
        this.button(this.root, 'Settings', 'Settings', 386, 235, 96, 32, () => this.go('Settings'), this.palette.panel, this.palette.white);
        this.label(this.root, 'Starport Assault', -300, 186, 310, 59, 30, this.palette.white);
        this.label(this.root, 'STARPORT  /  ' + (this.page === 'Lobby' ? 'Hangar' : this.page === 'StageSelect' ? 'Deployment' : this.page === 'Results' ? 'Debrief' : 'Control Center'), 140, 183, 520, 25, 13, this.palette.muted);
        if (this.page === 'Lobby')
            this.lobby();
        else if (this.page === 'StageSelect')
            this.stages();
        else if (this.page === 'Settings')
            this.settings();
        else
            this.results();
        this.label(this.root, 'OFFLINE TRAINING   /   STARPORT', -246, -247, 410, 22, 12, this.palette.muted);
        this.button(this.root, 'ExitGame', 'Back to Sample  ↗', 305, -244, 250, 35, () => this.callbacks.exit(), this.palette.panel, this.palette.cyan);
    }
    private lobby() {
        this.box(this.root, 'Hangar', -160, -16, 573, 304, this.palette.panel, 14);
        const g = this.graphics(this.root, 'HangarGrid');
        g.strokeColor = this.palette.line;
        g.lineWidth = 1;
        for (let x = -420; x < 100; x += 48) {
            g.moveTo(x, -133);
            g.lineTo(x + 70, 90);
        }
        for (let y = -133; y < 90; y += 35) {
            g.moveTo(-420, y);
            g.lineTo(90, y);
        }
        g.stroke();
        const halo = this.graphics(this.root, 'LandingPad');
        halo.strokeColor = this.palette.cyan;
        halo.lineWidth = 2;
        halo.ellipse(-177, -43, 104, 54);
        halo.stroke();
        halo.strokeColor = this.palette.line;
        halo.ellipse(-177, -43, 133, 70);
        halo.stroke();
        const ship = this.ship(this.root, 'HeroShip', this.palette.cyan, false);
        ship.setPosition(-177, -3);
        ship.setScale(3.2, 3.2);
        this.hangarShip = ship;
        this.label(this.root, 'Vanguard · MK 04', -171, 110, 390, 34, 23, this.palette.white);
        this.label(this.root, this.profile.weapon === 0 ? 'Heavy Pulse Cannon  /  High damage per shot' : 'Rapid Ion Cannon  /  Sustained fire', -160, -139, 500, 26, 14, this.palette.muted);
        this.box(this.root, 'Mission', 294, -16, 281, 304, this.palette.panel, 14);
        this.label(this.root, 'CURRENT MISSION', 295, 102, 240, 25, 13, this.palette.cyan);
        this.label(this.root, stages[this.runtime.stage]!, 295, 63, 240, 38, 26, this.palette.white);
        this.label(this.root, 'Clear three enemy waves.\nDefeat the Core Guardian\nand collect energy crystals.', 295, 0, 240, 64, 15, this.palette.muted);
        this.button(this.root, 'Deploy', 'Deploy  →', 295, -87, 225, 55, () => this.go('StageSelect'), this.palette.cyan, this.palette.bg);
        this.button(this.root, 'Weapon', 'Weapon: ' + (this.profile.weapon === 0 ? 'Pulse Cannon' : 'Ion Cannon'), -284, -199, 320, 40, () => { this.profile.weapon = 1 - this.profile.weapon; this.save(); this.track('equip_weapon'); this.go('Lobby'); }, this.palette.line, this.palette.white);
        this.button(this.root, 'Practice', 'Quick Training', 69, -199, 320, 40, () => this.go('Battle'), this.palette.panel, this.palette.cyan);
    }
    private stages() {
        stages.forEach((name, i) => {
            const x = -300 + i * 300, selected = i === this.runtime.stage;
            this.box(this.root, 'Stage' + i, x, -11, 278, 286, selected ? this.palette.line : this.palette.panel, 14);
            this.label(this.root, '0' + (i + 1), x - 74, 89, 96, 62, 44, selected ? this.palette.cyan : this.palette.muted);
            const g = this.graphics(this.root, 'StageArt' + i);
            g.strokeColor = selected ? this.palette.cyan : this.palette.blue;
            g.lineWidth = 3;
            g.moveTo(x + 40, 55);
            g.lineTo(x + 82, 88);
            g.lineTo(x + 51, 121);
            g.lineTo(x + 13, 88);
            g.close();
            g.stroke();
            this.label(this.root, name, x, 22, 254, 36, 23, this.palette.white);
            this.label(this.root, ['Beginner  /  Three waves', 'Advanced  /  Heavy armor', 'Challenge  /  Core Guardian'][i]!, x, -14, 252, 27, 14, this.palette.muted);
            this.label(this.root, ['Tip: practice moving and dashing', 'Tip: use cover to reposition', 'Tip: save your repair skill'][i]!, x, -49, 252, 24, 13, this.palette.muted);
            this.button(this.root, 'SelectStage' + i, selected ? 'Selected' : 'Select Stage', x, -109, 222, 41, () => { this.runtime.stage = i; this.track('select_stage'); this.go('StageSelect'); }, selected ? this.palette.cyan : this.palette.line, selected ? this.palette.bg : this.palette.white);
        });
        this.button(this.root, 'BackLobby', 'Back to Hangar', -274, -201, 310, 43, () => this.go('Lobby'), this.palette.panel, this.palette.white);
        this.button(this.root, 'StartBattle', 'Start Mission  →', 198, -201, 395, 43, () => this.go('Battle'), this.palette.cyan, this.palette.bg);
    }
    private settings() {
        this.box(this.root, 'ControlPanel', 0, -10, 870, 298, this.palette.panel, 14);
        this.label(this.root, 'Controls', -238, 101, 345, 32, 24, this.palette.white);
        this.label(this.root, 'Left stick: move and reposition.\nRight attack: hold to fire; auto-aims\nat the nearest enemy.\nDash: short burst with brief invincibility.\nRepair: restore 35 HP; has a cooldown.', -194, 3, 440, 136, 16, this.palette.muted);
        this.label(this.root, 'Keyboard controls\nWASD / Arrows: move · Space: fire\nShift: dash · E: repair · Esc: pause', -198, -111, 440, 59, 12, this.palette.muted);
        this.label(this.root, 'Battle Audio', 275, 72, 250, 33, 22, this.palette.white);
        this.button(this.root, 'Sound', this.profile.sound ? 'Sound: On' : 'Sound: Off', 275, 15, 229, 45, () => { this.profile.sound = !this.profile.sound; this.save(); this.track('toggle_sound'); this.go('Settings'); }, this.profile.sound ? this.palette.cyan : this.palette.line, this.profile.sound ? this.palette.bg : this.palette.white);
        this.label(this.root, 'Progress is saved locally.\nNo payments or\nreal transactions.', 273, -75, 255, 66, 15, this.palette.muted);
        this.button(this.root, 'Back', 'Back to Hangar', 0, -202, 340, 44, () => this.go('Lobby'), this.palette.cyan, this.palette.bg);
    }
    private battle() {
        this.model = new Arena(this.runtime.stage, this.profile.weapon);
        this.track('battle_start');
        this.arenaRoot = this.ui.node(this.root, 'Arena');
        this.box(this.arenaRoot, 'ArenaFloor', 0, 16, 820, 365, this.palette.panel, 8);
        const grid = this.graphics(this.arenaRoot, 'FloorGrid');
        grid.strokeColor = this.ui.color(24, 46, 62);
        grid.lineWidth = 1;
        for (let x = -400; x <= 400; x += 40) {
            grid.moveTo(x, -157);
            grid.lineTo(x, 190);
        }
        for (let y = -150; y < 190; y += 40) {
            grid.moveTo(-401, y);
            grid.lineTo(401, y);
        }
        grid.stroke();
        obstacles.forEach((o, i) => { this.box(this.arenaRoot, 'Cover' + i, o.x, o.y, o.w, o.h, this.palette.line, 5); this.box(this.arenaRoot, 'CoverLight' + i, o.x, o.y + o.h / 2 - 3, o.w - 8, 3, this.palette.cyan, 0); });
        this.player = this.ship(this.arenaRoot, 'Player', this.palette.cyan, false);
        this.box(this.root, 'TopHud', 0, 238, 930, 53, this.palette.bg, 8);
        this.label(this.root, 'MK04', -400, 249, 80, 20, 14, this.palette.white);
        this.hp = this.graphics(this.root, 'Health');
        this.energy = this.graphics(this.root, 'Energy');
        this.waveLabel = this.label(this.root, 'Ready for Deployment', 10, 247, 320, 27, 18, this.palette.white);
        this.scoreLabel = this.label(this.root, 'Crystals 0  /  Kills 0', 17, 220, 340, 22, 12, this.palette.muted);
        this.button(this.root, 'Pause', 'Ⅱ  Pause', 370, 239, 126, 38, () => this.pause(), this.palette.line, this.palette.white);
        this.toastLabel = this.label(this.root, 'Move to dodge enemies. Hold attack to clear three waves.', 0, -182, 850, 24, 14, this.palette.muted);
        this.stick = this.box(this.root, 'MoveJoystick', -333, -230, 122, 92, this.palette.panel, 42);
        const ring = this.graphics(this.stick, 'Ring');
        ring.strokeColor = this.palette.line;
        ring.lineWidth = 2;
        ring.circle(0, 0, 35);
        ring.stroke();
        this.knob = this.box(this.stick, 'Knob', 0, 0, 47, 47, this.palette.cyan, 23);
        this.label(this.root, 'Move', -430, -229, 63, 24, 13, this.palette.muted);
        this.ui.joystick(this.stick, (p, started) => this.stickMove(p, started), () => this.stickEnd());
        const attack = this.box(this.root, 'Attack', 360, -228, 126, 84, this.palette.cyan, 36);
        this.label(attack, 'Hold to\nAttack', 0, 0, 110, 60, 19, this.palette.bg);
        this.ui.hold(attack, () => this.fire(true), () => this.fire(false));
        const dash = this.button(this.root, 'Dash', '', 215, -231, 101, 64, () => this.skill('dash'), this.palette.blue, this.palette.white);
        this.dashLabel = this.label(dash, 'Dash', 0, 0, 95, 52, 17, this.palette.white);
        const heal = this.button(this.root, 'Repair', '', 92, -231, 101, 64, () => this.skill('heal'), this.palette.panel, this.palette.white);
        this.healLabel = this.label(heal, 'Repair', 0, 0, 95, 52, 17, this.palette.white);
        this.label(this.root, 'Cover blocks shots.\nKeep a clear line of fire.', -99, -233, 210, 45, 12, this.palette.muted);
        this.drawBattle();
    }
    private stickMove(p: Point, started: boolean) { if (!this.model || this.model.paused)
        return; this.touching = true; const len = Math.sqrt(p.x * p.x + p.y * p.y) || 1; const scale = Math.min(35, len) / len; this.knob!.setPosition(p.x * scale, p.y * scale); this.model.move = { x: p.x * scale / 35, y: p.y * scale / 35 }; if (started)
        this.track('joystick_move'); }
    private stickEnd() { this.touching = false; if (this.knob)
        this.knob.setPosition(0, 0); if (this.model)
        this.model.move = { x: 0, y: 0 }; }
    private fire(on: boolean) { if (!this.model)
        return; this.model.firing = on && !this.model.paused; if (on && !this.model.paused) {
        this.model.trigger();
        this.track('fire_pressed');
    } }
    private skill(which: string) { if (!this.model)
        return; const used = which === 'dash' ? this.model.dash() : this.model.heal(); if (!used && this.toastLabel)
        this.toastLabel.string = which === 'dash' ? 'Dash is on cooldown' : 'Health is full or repair is on cooldown'; }
    private drawBattle() {
        const m = this.model;
        if (!m)
            return;
        this.player.setPosition(m.player.x, m.player.y);
        this.player.angle = -Math.atan2(m.facing.x, m.facing.y) * 180 / Math.PI;
        this.ui.opacity(this.player, m.invincible > 0 ? 155 : 255);
        const present: {
            [k: string]: boolean;
        } = {};
        m.enemies.forEach(e => { const key = 'e' + e.id; present[key] = true; let n = this.actors[key]; if (!n) {
            n = this.ship(this.arenaRoot, key, e.boss ? this.palette.gold : this.palette.red, true);
            if (e.boss)
                n.setScale(1.6, 1.6);
            this.actors[key] = n;
        } n.setPosition(e.x, e.y); n.angle = -Math.atan2(m.player.x - e.x, m.player.y - e.y) * 180 / Math.PI; });
        m.bullets.forEach(b => { const key = 'b' + b.id; present[key] = true; let n = this.actors[key]; if (!n) {
            n = this.box(this.arenaRoot, key, 0, 0, 5, 15, this.palette.cyan, 2);
            this.actors[key] = n;
        } n.setPosition(b.x, b.y); n.angle = -Math.atan2(b.vx, b.vy) * 180 / Math.PI; });
        m.drops.forEach(c => { const key = 'c' + c.id; present[key] = true; let n = this.actors[key]; if (!n) {
            n = this.box(this.arenaRoot, key, 0, 0, 10, 10, this.palette.gold, 1);
            n.angle = 45;
            this.actors[key] = n;
        } n.setPosition(c.x, c.y); });
        Object.keys(this.actors).forEach(key => { if (!present[key]) {
            this.actors[key]!.destroy();
            delete this.actors[key];
        } });
        this.bar(this.hp, -350, 244, 178, 10, m.hp / 100, m.hp > 30 ? this.palette.cyan : this.palette.red);
        this.bar(this.energy, -350, 227, 178, 5, m.energy / 100, this.palette.gold);
        this.waveLabel.string = m.wave ? 'Wave ' + m.wave + ' / 3   ·   ' + Math.floor(m.elapsed) + 's' : 'Scanning airspace…';
        this.scoreLabel.string = stages[this.runtime.stage]! + '   /   Crystals ' + m.crystals + '   /   Kills ' + m.kills;
        this.dashLabel.string = m.dashCooldown > 0 ? 'Dash\n' + m.dashCooldown.toFixed(1) + 's' : 'Dash';
        this.healLabel.string = m.healCooldown > 0 ? 'Repair\n' + Math.ceil(m.healCooldown) + 's' : 'Repair';
    }
    private gameEvent(e: ArenaEvent) {
        if (e.name === 'shot') {
            this.sound('shoot');
            return;
        }
        this.track(e.name, { value: e.value, wave: this.model!.wave });
        const text: {
            [key: string]: string;
        } = { wave_start: 'Alert: wave ' + e.value + ' enemies incoming', damage: 'Armor damaged! Dash to gain distance.', repair: 'Armor repaired +35', dash: 'Dash! Brief invincibility', boss_defeated: 'Core Guardian destroyed', crystal_collected: 'Energy crystal collected +1' };
        if (text[e.name] && this.toastLabel)
            this.toastLabel.string = text[e.name]!;
        if (e.name === 'damage' || e.name === 'enemy_defeated')
            this.sound('hit');
        if (e.name === 'crystal_collected')
            this.sound('pickup');
    }
    private pause() {
        if (!this.model || this.finalizing)
            return;
        if (this.model.paused) {
            this.resume();
            return;
        }
        this.model.pause(true);
        this.stickEnd();
        this.keys = {};
        this.overlay = this.box(this.root, 'PauseOverlay', 0, 0, 960, 540, this.ui.color(5, 12, 23, 230), 0);
        this.ui.block(this.overlay);
        this.box(this.overlay, 'PauseCard', 0, 5, 430, 313, this.palette.panel, 18);
        this.label(this.overlay, 'Mission Paused', 0, 116, 380, 44, 30, this.palette.white);
        this.label(this.overlay, 'Regroup and prepare to return to battle.', 0, 73, 380, 28, 15, this.palette.muted);
        this.button(this.overlay, 'Resume', 'Resume Battle', 0, 14, 320, 49, () => this.resume(), this.palette.cyan, this.palette.bg);
        this.button(this.overlay, 'Restart', 'Restart Mission', 0, -48, 320, 43, () => { this.track('restart_battle'); this.go('Battle'); }, this.palette.line, this.palette.white);
        this.button(this.overlay, 'Abandon', 'Retreat to Hangar', 0, -105, 320, 43, () => { this.track('abandon_battle'); this.go('Lobby'); }, this.palette.panel, this.palette.muted);
    }
    private resume() { if (!this.model)
        return; if (this.overlay) {
        this.overlay.active = false;
        this.overlay.destroy();
        this.overlay = null;
    } this.model.pause(false); this.keys = {}; this.stickEnd(); }
    private finish() { const m = this.model!; const won = m.status === 'won'; const reward = m.kills * 4 + m.crystals * 6 + (won ? 80 : 10); this.profile.coins += reward; this.profile.best = Math.max(this.profile.best, m.kills); this.save(); this.runtime.result = { won, kills: m.kills, crystals: m.crystals, time: Math.floor(m.elapsed), reward, stage: this.runtime.stage }; this.sound(won ? 'victory' : 'hit'); this.track('battle_complete', this.runtime.result); this.go('Results'); }
    private results() {
        const r = this.runtime.result || { won: false, kills: 0, crystals: 0, time: 0, reward: 0, stage: this.runtime.stage };
        this.box(this.root, 'Results', 0, -1, 860, 282, this.palette.panel, 16);
        this.label(this.root, r.won ? 'Airspace Cleared' : 'Mission Failed', 0, 99, 770, 46, 32, r.won ? this.palette.cyan : this.palette.gold);
        this.label(this.root, r.won ? 'Core Guardian destroyed. Vanguard returning to base.' : 'Adjust your tactics and try again.', 0, 58, 780, 29, 16, this.palette.muted);
        [['Enemies Defeated', r.kills], ['Crystals Collected', r.crystals], ['Mission Time', r.time + 's'], ['Supplies Earned', '+' + r.reward]].forEach((a, i) => { const x = -312 + i * 208; this.label(this.root, '' + a[1], x, -12, 195, 52, 35, i === 3 ? this.palette.gold : this.palette.white); this.label(this.root, '' + a[0], x, -57, 195, 25, 14, this.palette.muted); });
        this.label(this.root, 'Supplies added to your local training save.', 0, -110, 700, 24, 13, this.palette.muted);
        this.button(this.root, 'ResultLobby', 'Back to Hangar', -277, -189, 265, 49, () => this.go('Lobby'), this.palette.line, this.palette.white);
        this.button(this.root, 'Retry', 'Play Again', 0, -189, 265, 49, () => this.go('Battle'), this.palette.cyan, this.palette.bg);
        this.button(this.root, 'NextStage', 'Next Stage  →', 277, -189, 265, 49, () => { this.runtime.stage = (this.runtime.stage + 1) % 3; this.go('StageSelect'); }, this.palette.panel, this.palette.cyan);
    }
    private sound(name: string) { if (this.profile.sound)
        this.ui.sound(name); }
    private graphics(parent: GameNode, name: string) { return this.ui.graphics(parent, name); }
    private box(parent: GameNode, name: string, x: number, y: number, w: number, h: number, c: GameColor, r = 8) { return this.ui.box(parent, name, x, y, w, h, c, r); }
    private label(parent: GameNode, text: string, x: number, y: number, w: number, h: number, size: number, c: GameColor) { return this.ui.label(parent, text, x, y, w, h, size, c); }
    private button(parent: GameNode, name: string, text: string, x: number, y: number, w: number, h: number, fn: () => void, bg: GameColor, fg: GameColor) { return this.ui.button(parent, name, text, x, y, w, h, () => { this.sound('pickup'); fn(); }, bg, fg); }
    private ship(parent: GameNode, name: string, color: GameColor, enemy: boolean) { const n = this.ui.node(parent, name); const g = this.ui.graphics(n, 'Hull'); g.fillColor = color; g.moveTo(0, 22); g.lineTo(19, -14); g.lineTo(7, -10); g.lineTo(0, -15); g.lineTo(-7, -10); g.lineTo(-19, -14); g.close(); g.fill(); g.fillColor = this.palette.bg; g.moveTo(0, 11); g.lineTo(6, -3); g.lineTo(-6, -3); g.close(); g.fill(); g.fillColor = enemy ? this.palette.gold : this.palette.white; g.roundRect(-4, -20, 8, 7, 2); g.fill(); return n; }
    private bar(g: GameGraphics, x: number, y: number, w: number, h: number, value: number, color: GameColor) { g.clear(); g.fillColor = this.palette.line; g.roundRect(x, y, w, h, h / 2); g.fill(); g.fillColor = color; g.roundRect(x, y, Math.max(h, w * Math.max(0, value)), h, h / 2); g.fill(); }
}
