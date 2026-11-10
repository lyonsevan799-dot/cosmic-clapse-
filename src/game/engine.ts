// Canvas game engine: loop, input, physics, endless procedural spawning, absorption, rendering.
import { PLAYER, SKINS, kindAt, topEligibleIndex, type Kind, type Skin } from "./data";
import { addMass, canAbsorb, formatMass, radiusForMass, type Settings } from "./logic";
import { getSprite, rng, VARIANTS, type Sprite } from "./sprites";
import { drawBlackHole } from "./blackhole";
import { sfx } from "./audio";
import { MAX_SPEED, BOOST, SURGE, steer,
  ARENA, PERSONALITIES, SpatialGrid, botStartMass, canEat, computeLeaderboard, decide,
  drainSurgeMass, effectiveMass, eliminationReward, makeBotName, newSurge, pickPersonality, randomSkin,
  shouldSurge, spawnPosAwayFrom, tickSurge, trySurge,
  type Bot, type LeaderEntry, type SurgeState,
} from "./arena";

interface Body {
  kind: Kind; x: number; y: number; vx: number; vy: number; r: number; mass: number;
  rot: number; spin: number; variant: number; sprite: Sprite | null; seed: number;
  absorbing: boolean; t: number; dur: number; a0: number; d0: number; dir: number;
  eligible: boolean; inField: boolean; dead: boolean; trailT: number;
  /** Arena only: the bot absorbing this body. null = the player. */
  absorber: Bot | null;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; }
interface Ring { x: number; y: number; r: number; max: number; life: number; dur: number; color: string; width: number; }
interface FloatText { text: string; life: number; color: string; big: boolean; }

export interface HudState {
  mass: number; time: number;
  surgePhase: "ready" | "active" | "cooldown";
  /** Active time remaining, or cooldown recharge progress. */
  surgeProgress: number;
  surgeRemaining: number;
  surgeCooldown: number;
}
export interface EngineCallbacks {
  onHud?: (h: HudState) => void;
  onPauseRequest?: () => void;
  onBlur?: () => void;
  onToast?: (msg: string) => void;
  onTutorial?: (ev: "moved" | "pulled" | "absorbed") => void;
  onAbsorb?: (kind: Kind, gain: number, mass: number) => void;
  onArena?: (a: { leaders: LeaderEntry[]; rank: number; alive: number }) => void;
  onEliminated?: (killer: string) => void;
  onKill?: (message: string) => void;
}
export interface EngineConfig { skin: string; settings: Settings; }

const MAX_PARTICLES = 420;
const TAU = Math.PI * 2;
const SPAWN_OFFSETS: [number, number][] = [[-4, 10], [-3, 18], [-2, 26], [-1, 26], [0, 14], [1, 6], [2, 2]];
const ERA_HUES: [number, number][] = [[220, 260], [200, 250], [160, 220], [270, 210], [330, 270], [300, 200], [20, 300], [40, 280], [180, 320]];

export class Engine {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; cb: EngineCallbacks;
  w = 0; h = 0; dpr = 1; raf = 0; last = 0; destroyed = false;
  mode: "demo" | "play" = "demo"; paused = false;
  bodies: Body[] = []; particles: Particle[] = []; pool: Particle[] = []; rings: Ring[] = []; texts: FloatText[] = [];
  player = { x: 0, y: 0, vx: 0, vy: 0, mass: 10, disp: 10 };
  cam = { x: 0, y: 0, zoom: 1 }; bgOff = { x: 0, y: 0 };
  time = 0; runTime = 0; shake = 0; flash = 0; flashColor = "#fff"; pulse = 0;
  keys = new Set<string>(); joy = { x: 0, y: 0 };
  mouse = { x: 0, y: 0, active: false, down: false }; boostBtn = false; boosting = false; private shedT = 0;
  pSurge: SurgeState = newSurge(); private farm = new Map<string, number>();
  cfg: EngineConfig = { skin: "horizon", settings: { audio: true, sfx: 0.7, music: 0.4, shake: true, reduced: false, botCount: 100 } };
  skin: Skin = SKINS[0];
  topIdx = 0; hudT = 0; movedDist = 0; movedSent = false; pulledSent = false;
  highlight = false; demoDir = 0; seedN = 1; era = -1;
  starTiles: HTMLCanvasElement[] = []; nebula: HTMLCanvasElement | null = null; nebulaHues = "";
  shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  arena = false; bots: Bot[] = []; playerAlive = true;
  worldR: number = ARENA.worldRadius; arenaHudT = 0; playerDieT = 0;
  playerKiller: Bot | null = null;
  private botGrid = new SpatialGrid<Bot>(240);
  private foodGrid = new SpatialGrid<Body>(240);

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas; this.cb = cb;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering is unavailable");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("pointermove", this.onPMove);
    canvas.addEventListener("pointerdown", this.onPDown);
    window.addEventListener("pointerup", this.onPUp);
    window.addEventListener("blur", this.onBlurEv);
    document.addEventListener("visibilitychange", this.onVis);
    this.buildStars();
    this.startDemo();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true; cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointermove", this.onPMove);
    this.canvas.removeEventListener("pointerdown", this.onPDown);
    window.removeEventListener("pointerup", this.onPUp);
    window.removeEventListener("blur", this.onBlurEv);
    document.removeEventListener("visibilitychange", this.onVis);
  }

  setConfig(c: EngineConfig) { this.cfg = c; this.skin = SKINS.find((s) => s.id === c.skin) ?? SKINS[0]; }

  // ---------- input ----------
  onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === "escape") { if (this.mode === "play") this.cb.onPauseRequest?.(); return; }
    if (k === " ") {
      const tgt = e.target as HTMLElement | null;
      if (tgt && ["INPUT", "SELECT", "BUTTON"].includes(tgt.tagName)) return;
      if (this.mode === "play") { e.preventDefault(); this.keys.add("space"); } return;
    }
    if ((k === "e" || k === "shift") && !e.repeat) { if (this.mode === "play" && !this.paused) this.surge(); return; }
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "SELECT")) return;
      if (this.mode === "play" && !this.paused && k.startsWith("arrow")) e.preventDefault();
      this.keys.add(k);
    }
  };
  onKeyUp = (e: KeyboardEvent) => { const k = e.key.toLowerCase(); this.keys.delete(k === " " ? "space" : k); };
  onPMove = (e: PointerEvent) => { if (e.pointerType !== "mouse") return; this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.active = true; };
  onPDown = (e: PointerEvent) => { if (e.pointerType !== "mouse") return; this.onPMove(e); this.mouse.down = true; };
  onPUp = () => { this.mouse.down = false; };
  setBoost(on: boolean) { this.boostBtn = on; }
  /** Mass Surge: temporary radius and absorption power, paid for with mass. */
  surge() {
    if (this.mode !== "play" || this.paused || !this.arena || !this.playerAlive || !trySurge(this.pSurge)) return;
    const P = this.player, r = radiusForMass(P.mass);
    this.rings.push({ x: P.x, y: P.y, r, max: r * 3.2, life: 0, dur: 0.55, color: this.skin.hot, width: 4 });
    this.texts.push({ text: "MASS SURGE", life: 0, color: this.skin.hot, big: true });
    sfx.surgeStart(); this.emitHud();
  }
  onBlurEv = () => { this.resetInput(); if (this.mode === "play" && !this.paused) this.cb.onBlur?.(); };
  onVis = () => { if (document.hidden) this.onBlurEv(); };
  resetInput() { this.keys.clear(); this.joy.x = 0; this.joy.y = 0; this.mouse.down = false; this.mouse.active = false; this.boostBtn = false; this.boosting = false; }
  /** Ordinary mass-ratio absorption using each hole's current smooth Surge scale. */
  private canTake(aMass: number, aSurge: SurgeState, vMass: number, vSurge: SurgeState) {
    return canEat(effectiveMass(aMass, aSurge.scale), effectiveMass(vMass, vSurge.scale));
  }
  setJoystick(x: number, y: number) { this.joy.x = x; this.joy.y = y; }

  resize = () => {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr); this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + "px"; this.canvas.style.height = this.h + "px";
  };

  // ---------- state ----------
  private reset(mass: number) {
    this.bodies = []; this.rings = []; this.texts = [];
    for (const p of this.particles) this.pool.push(p);
    this.particles = [];
    this.player = { x: 0, y: 0, vx: 0, vy: 0, mass, disp: mass };
    this.cam = { x: 0, y: 0, zoom: this.zoomFor(mass) };
    this.pSurge = newSurge();
    this.time = 0; this.runTime = 0; this.shake = 0; this.flash = 0;
    this.topIdx = topEligibleIndex(mass);
    this.movedDist = 0; this.movedSent = false; this.pulledSent = false;
    this.resetInput();
    this.updateEra(true);
    for (let i = 0; i < PLAYER.density; i++) this.spawn(true);
  }
  startDemo() { this.arena = false; this.bots = []; this.playerAlive = true; this.mode = "demo"; this.paused = false; this.reset(300); }
  startRun(mass: number) { this.arena = false; this.bots = []; this.playerAlive = true; this.mode = "play"; this.paused = false; this.reset(Math.max(PLAYER.startMass, mass)); this.emitHud(); }
  startArena(count = this.cfg.settings.botCount) {
    this.startRun(PLAYER.startMass);
    this.arena = true; this.playerDieT = 0; this.playerKiller = null; this.pSurge = newSurge(); this.farm.clear();
    this.worldR = ARENA.worldRadius;
    const used = new Set<string>();
    this.bots = Array.from({ length: Math.max(10, Math.min(150, Math.round(count))) }, (_, id) => {
      const mass = botStartMass(Math.random, PLAYER.startMass);
      const pos = spawnPosAwayFrom(Math.random, 0, 0, this.viewRadius() * 0.55, this.worldR, radiusForMass(mass), 24);
      return { id, name: makeBotName(Math.random, used), skin: randomSkin(Math.random), ...pos,
        vx: 0, vy: 0, mass, disp: mass, personality: pickPersonality(Math.random),
        speed: 0.8 + Math.random() * 0.35, thinkT: Math.random() * 0.4, mode: "wander" as const,
        tx: pos.x, ty: pos.y, foodRef: null, alive: true, respawnT: 0,
        dying: false, dieT: 0, dieDur: 0.6, eater: null, wob: Math.random() * TAU, surge: newSurge() };
    });
    this.bodies = [];
    for (let i = 0; i < ARENA.density; i++) this.spawnArenaFood(i < 70);
    this.emitArena(); this.emitHud();
  }
  pause() { this.paused = true; this.resetInput(); }
  resume() { this.paused = false; this.resetInput(); this.last = performance.now(); }

  /** Black hole occupies a bounded share of the screen: grows visibly early, then levels off. */
  screenRadius(mass: number) {
    const g = 1 - Math.exp(-Math.log10(Math.max(1, mass / PLAYER.startMass)) / 4);
    return Math.min(this.w, this.h) * (0.035 + 0.05 * g);
  }
  zoomFor(mass: number) {
    const normal = this.screenRadius(mass) / radiusForMass(mass);
    const minimum = Math.max(1, Math.min(this.w, this.h)) / (ARENA.worldRadius * 6);
    // Smooth asymptote: normal early zoom, diminishing zoom-out at enormous sizes.
    return Math.hypot(normal, minimum);
  }
  viewRadius() { return Math.hypot(this.w, this.h) / 2 / this.cam.zoom; }

  private updateEra(force = false) {
    const era = Math.floor(this.topIdx / 3);
    if (era === this.era && !force) return;
    this.era = era;
    this.buildNebula(ERA_HUES[era % ERA_HUES.length].map((h) => (h + Math.floor(era / ERA_HUES.length) * 37) % 360) as [number, number]);
  }

  // ---------- spawning ----------
  private pickKind(forceEligible: boolean): Kind {
    const opts: [number, number][] = [];
    for (const [o, w] of SPAWN_OFFSETS) {
      const i = this.topIdx + o;
      if (i < 0 || (forceEligible && o > 0)) continue;
      // skip objects that would be invisibly small on screen
      const k = kindAt(i);
      if (radiusForMass(k.mass) * 0.8 * k.size * this.cam.zoom < 1.2 && o < 0) continue;
      opts.push([i, w]);
    }
    if (!opts.length) opts.push([this.topIdx, 1]);
    const total = opts.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    for (const [i, w] of opts) { r -= w; if (r <= 0) return kindAt(i); }
    return kindAt(opts[0][0]);
  }

  private spawn(initial: boolean, forceEligible = false) {
    const kind = this.pickKind(forceEligible);
    const k = Math.random();
    const mass = kind.mass * (0.7 + 0.6 * k);
    const r = radiusForMass(mass) * 0.8 * kind.size;
    const vr = this.viewRadius();
    const pr = radiusForMass(this.player.mass);
    let x = 0, y = 0;
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * TAU;
      const d = initial ? pr * 4 + r + Math.random() * vr * 1.7 : vr * (1.1 + Math.random() * 0.7) + r;
      x = this.player.x + Math.cos(a) * d; y = this.player.y + Math.sin(a) * d;
      if (kind.tier === 0) break;
      if (!this.bodies.some((b) => b.r > r * 0.3 && Math.abs(b.x - x) < r * 2.5 + b.r && Math.abs(b.y - y) < r * 2.5 + b.r)) break;
    }
    const variant = Math.floor(Math.random() * VARIANTS);
    const drift = r * 1.4;
    this.bodies.push({
      kind, x, y, mass, r,
      vx: (Math.random() - 0.5) * drift, vy: (Math.random() - 0.5) * drift,
      rot: Math.random() * TAU, spin: (Math.random() - 0.5) * (kind.tier === 0 ? 1.6 : kind.tier === 3 ? 0.15 : 0.3),
      variant, sprite: getSprite(kind, variant), seed: this.seedN++,
      absorbing: false, t: 0, dur: kind.absorbTime, a0: 0, d0: 0, dir: 1,
      eligible: false, inField: false, dead: false, trailT: 0, absorber: null,
    });
  }

  private spawnArenaFood(nearPlayer = false) {
    // Reuse the exact object construction and mass rules from endless mode.
    const oldTop = this.topIdx;
    const bot = this.bots[Math.floor(Math.random() * this.bots.length)];
    this.topIdx = nearPlayer ? oldTop : topEligibleIndex(bot?.mass ?? this.player.mass);
    this.spawn(true, true); this.topIdx = oldTop;
    const body = this.bodies[this.bodies.length - 1];
    if (!body) return;
    if (nearPlayer) {
      if (Math.hypot(body.x, body.y) <= this.worldR * 0.97) return;
      const pos = spawnPosAwayFrom(Math.random, this.player.x, this.player.y,
        radiusForMass(this.player.mass) * 4 + body.r, this.worldR * 0.97);
      body.x = pos.x; body.y = pos.y;
      return;
    }
    const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * this.worldR * 0.97;
    body.x = Math.cos(a) * d; body.y = Math.sin(a) * d;
  }

  private clampToArena(o: { x: number; y: number; vx: number; vy: number }) {
    const d = Math.hypot(o.x, o.y);
    if (d <= this.worldR) return;
    o.x *= this.worldR / d; o.y *= this.worldR / d;
    o.vx *= 0.3; o.vy *= 0.3;
  }

  private emitArena() {
    const lb = computeLeaderboard(this.bots, this.player.mass, this.playerAlive);
    this.cb.onArena?.({ ...lb, alive: this.bots.filter((b) => b.alive).length + (this.playerAlive ? 1 : 0) });
  }

  /** Bright aura and activation pulse; radius itself is rendered by the boosted black hole. */
  private surgeAura(x: number, y: number, r: number, s: SurgeState, color: string) {
    const energy = (s.scale - 1) / (SURGE.radiusMult - 1);
    if (!Number.isFinite(x + y + r + energy) || r <= 0 || energy <= 0.01) return;
    const ctx = this.ctx; ctx.save(); ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(x, y, r, x, y, r * 2.2);
    glow.addColorStop(0, color + "55"); glow.addColorStop(0.45, color + "22"); glow.addColorStop(1, color + "00");
    ctx.globalAlpha = energy * (0.75 + 0.15 * Math.sin(this.time * 12));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, TAU); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, r * 0.05);
    ctx.globalAlpha = energy * 0.65; ctx.setLineDash([r * 0.3, r * 0.18]); ctx.lineDashOffset = -this.time * r;
    ctx.beginPath(); ctx.arc(x, y, r * 1.28, 0, TAU); ctx.stroke();
    if (s.active && s.t < 0.55) {
      const p = s.t / 0.55;
      ctx.setLineDash([]); ctx.globalAlpha = (1 - p) * 0.8; ctx.lineWidth = Math.max(2, r * 0.08 * (1 - p));
      ctx.beginPath(); ctx.arc(x, y, r * (1.1 + p * 1.5), 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  private eatBot(victim: Bot, eater: Bot | "player") {
    if (!victim.alive || victim.dying) return;
    victim.alive = false; victim.dying = true; victim.dieT = 0; victim.eater = eater;
    this.cb.onKill?.(`${eater === "player" ? "You" : eater.name} absorbed ${victim.name}`);
  }

  private updateBots(dt: number) {
    const P = this.player;
    this.botGrid.clear(); this.foodGrid.clear();
    for (const bot of this.bots) {
      if (![bot.x, bot.y, bot.vx, bot.vy, bot.mass, bot.disp, bot.tx, bot.ty, bot.respawnT, bot.dieT, bot.dieDur, bot.thinkT, bot.speed, bot.wob].every(Number.isFinite) || bot.mass <= 0 || bot.disp <= 0 || bot.dieDur <= 0) {
        if (import.meta.env.DEV) console.warn("Recovering invalid arena opponent", bot.id);
        Object.assign(bot, { x: 0, y: 0, vx: 0, vy: 0, mass: PLAYER.startMass, disp: PLAYER.startMass,
          tx: 0, ty: 0, alive: false, dying: false, eater: null, respawnT: 0, dieT: 0, dieDur: 0.6, thinkT: 0, speed: 0.8, wob: 0, surge: newSurge() });
      }
    }
    for (const b of this.bots) if (b.alive) this.botGrid.insert(b);
    for (const b of this.bodies) if (!b.dead && !b.absorbing) this.foodGrid.insert(b);
    for (const bot of this.bots) {
      if (bot.dying) {
        bot.dieT += dt;
        const target = bot.eater === "player" ? P : bot.eater;
        if (target) { bot.x += (target.x - bot.x) * Math.min(1, dt * 9); bot.y += (target.y - bot.y) * Math.min(1, dt * 9); }
        if (bot.dieT >= bot.dieDur) {
          if (bot.eater === "player" && this.playerAlive) {
            const last = this.farm.get(bot.name), farmed = last !== undefined && this.time - last < SURGE.farmWindow;
            this.farm.set(bot.name, this.time);
            const gain = eliminationReward(bot.mass, P.mass, farmed);
            P.mass = addMass(P.mass, gain); this.topIdx = topEligibleIndex(P.mass);
            this.texts.push({ text: `+${formatMass(gain)} MASS`, life: 0, color: this.skin.mid, big: true });
            sfx.absorbPlanet();
          } else if (bot.eater && bot.eater !== "player" && bot.eater.alive) bot.eater.mass = addMass(bot.eater.mass, eliminationReward(bot.mass, bot.eater.mass, false));
          bot.dying = false; bot.eater = null;
          bot.respawnT = ARENA.respawnMin + Math.random() * (ARENA.respawnMax - ARENA.respawnMin);
        }
        continue;
      }
      if (!bot.alive) {
        bot.respawnT -= dt;
        if (bot.respawnT <= 0) {
          bot.mass = bot.disp = botStartMass(Math.random, PLAYER.startMass);
          const radius = radiusForMass(bot.mass);
          const pos = spawnPosAwayFrom(Math.random, P.x, P.y,
            Math.max(this.viewRadius() * 0.7, radiusForMass(P.mass) + radius + 24), this.worldR, radius, 24);
          Object.assign(bot, pos);
          bot.vx = bot.vy = 0; bot.alive = true; bot.thinkT = 0; bot.mode = "wander";
          bot.tx = pos.x; bot.ty = pos.y; bot.foodRef = null; bot.surge = newSurge();
        }
        continue;
      }
      if (bot.surge.active) bot.mass = drainSurgeMass(bot.mass, Math.min(dt, Math.max(0, SURGE.duration - bot.surge.t)));
      tickSurge(bot.surge, dt);
      const r = radiusForMass(bot.mass) * bot.surge.scale;
      bot.thinkT -= dt;
      if (bot.thinkT <= 0) {
        const react = PERSONALITIES[bot.personality].react;
        bot.thinkT = react[0] + Math.random() * (react[1] - react[0]);
        const nearby: Bot[] = []; this.botGrid.query(bot.x, bot.y, r * ARENA.senseMult, nearby);
        let threat: { x: number; y: number; mass: number } | null = null, prey: { x: number; y: number } | null = null;
        let td = Infinity, pd = Infinity;
        for (const other of [...nearby, ...(this.playerAlive ? [P] : [])]) {
          if (other === bot || ("alive" in other && !other.alive)) continue;
          const d = Math.hypot(other.x - bot.x, other.y - bot.y);
          if (d > r * ARENA.senseMult) continue;
          const otherSurge = other === P ? this.pSurge : (other as Bot).surge;
          if (this.canTake(other.mass, otherSurge, bot.mass, bot.surge) && d < td) { threat = other; td = d; }
          if (this.canTake(bot.mass, bot.surge, other.mass, otherSurge) && d < pd) { prey = other; pd = d; }
        }
        const foods: Body[] = []; this.foodGrid.query(bot.x, bot.y, r * ARENA.senseMult, foods);
        let food: Body | null = null, fd = Infinity;
        for (const b of foods) if (canAbsorb(effectiveMass(bot.mass, bot.surge.scale), b.kind)) {
          const d = Math.hypot(b.x - bot.x, b.y - bot.y) / Math.sqrt(b.mass + 1);
          if (d < fd) { food = b; fd = d; }
        }
        decide(bot, { threat, prey, food }, Math.random, this.worldR);
        if (shouldSurge(bot.surge, bot.mode, bot.mode === "hunt" ? pd : td, r, Math.random)) trySurge(bot.surge);
      }
      const dx = bot.tx - bot.x, dy = bot.ty - bot.y, d = Math.hypot(dx, dy) || 1;
      const a = Math.atan2(dy, dx) + Math.sin(this.time * 1.4 + bot.wob) * 0.12;
      const speed = MAX_SPEED * Math.min(0.95, bot.speed);
      const inp = Math.min(1, d / (r * 3));
      steer(bot, Math.cos(a) * inp, Math.sin(a) * inp, speed, dt);
      bot.x += bot.vx * dt; bot.y += bot.vy * dt; this.clampToArena(bot);
      bot.disp = Math.exp(Math.log(bot.disp) + (Math.log(bot.mass) - Math.log(bot.disp)) * (1 - Math.exp(-dt * 4)));
      const nearby: Bot[] = []; this.botGrid.query(bot.x, bot.y, r * 3, nearby);
      for (const other of nearby) {
        if (other === bot || !other.alive || !bot.alive) continue;
        const od = Math.hypot(bot.x - other.x, bot.y - other.y), orad = radiusForMass(other.mass) * other.surge.scale;
        if (this.canTake(bot.mass, bot.surge, other.mass, other.surge) && od < r * 0.95 + orad * 0.35) this.eatBot(other, bot);
      }
      if (this.playerAlive && bot.alive) {
        const distance = Math.hypot(bot.x - P.x, bot.y - P.y), prad = radiusForMass(P.mass) * this.pSurge.scale;
        if (this.canTake(P.mass, this.pSurge, bot.mass, bot.surge) && distance < prad * 0.95 + r * 0.35) this.eatBot(bot, "player");
        else if (this.canTake(bot.mass, bot.surge, P.mass, this.pSurge) && distance < r * 0.95 + prad * 0.35) {
          this.playerAlive = false; this.playerKiller = bot; this.playerDieT = 0; this.resetInput();
          this.cb.onKill?.(`${bot.name} absorbed You`);
        }
      }
    }
    if (!this.playerAlive && this.playerKiller) {
      this.playerDieT += dt;
      P.x += (this.playerKiller.x - P.x) * Math.min(1, dt * 9); P.y += (this.playerKiller.y - P.y) * Math.min(1, dt * 9);
      if (this.playerDieT >= 0.65) {
        if (this.playerKiller.alive) this.playerKiller.mass = addMass(this.playerKiller.mass, eliminationReward(P.mass, this.playerKiller.mass, false));
        this.pause(); this.emitHud(); this.emitArena(); this.cb.onEliminated?.(this.playerKiller.name);
      }
    }
    this.arenaHudT -= dt;
    if (this.arenaHudT <= 0) { this.arenaHudT = 0.25; this.emitArena(); }
  }

  // ---------- loop ----------
  loop = (now: number) => {
    if (this.destroyed) return;
    // Schedule first: a recoverable entity failure cannot stop future frames.
    // Unrelated programming errors still surface normally; no blanket catch.
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(1 / 30, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.paused) this.update(dt);
    this.render();
  };

  /** Keep coordinates near the origin so precision holds at any scale. */
  private rebase() {
    if (this.arena) return;
    const P = this.player;
    const lim = radiusForMass(P.mass) * 2000;
    if (Math.abs(P.x) < lim && Math.abs(P.y) < lim) return;
    const ox = P.x, oy = P.y;
    P.x = 0; P.y = 0; this.cam.x -= ox; this.cam.y -= oy;
    for (const b of this.bodies) { b.x -= ox; b.y -= oy; }
    for (const p of this.particles) { p.x -= ox; p.y -= oy; }
    for (const r of this.rings) { r.x -= ox; r.y -= oy; }
  }

  private update(dt: number) {
    this.time += dt;
    const P = this.player;
    const playing = this.mode === "play";
    if (playing) this.runTime += dt;

    let ix = 0, iy = 0;
    if (playing && this.playerAlive) {
      if (this.keys.has("a") || this.keys.has("arrowleft")) ix -= 1;
      if (this.keys.has("d") || this.keys.has("arrowright")) ix += 1;
      if (this.keys.has("w") || this.keys.has("arrowup")) iy -= 1;
      if (this.keys.has("s") || this.keys.has("arrowdown")) iy += 1;
      ix += this.joy.x; iy += this.joy.y;
      if (ix === 0 && iy === 0 && this.mouse.active) {
        // slither.io style: head toward the cursor, full speed once it is a little away from the centre
        const mx = this.mouse.x - this.w / 2, my = this.mouse.y - this.h / 2, md = Math.hypot(mx, my);
        const full = Math.min(this.w, this.h) * 0.18;
        if (md > 6) { const k = Math.min(1, md / full) / md; ix = mx * k; iy = my * k; }
      }
    } else if (!playing) {
      this.demoDir += (Math.sin(this.time * 0.37) * 0.6 + Math.sin(this.time * 0.13)) * dt;
      ix = Math.cos(this.demoDir) * 0.55; iy = Math.sin(this.demoDir) * 0.55;
    }
    const il = Math.hypot(ix, iy); if (il > 1) { ix /= il; iy /= il; }
    if (this.arena && this.playerAlive) {
      if (this.pSurge.active) P.mass = drainSurgeMass(P.mass, Math.min(dt, Math.max(0, SURGE.duration - this.pSurge.t)));
      if (tickSurge(this.pSurge, dt) === "ended") sfx.surgeEnd();
    }
    // smooth visual growth (in log space so huge jumps stay smooth)
    const lg = Math.log(Math.max(1, P.disp)), lt = Math.log(Math.max(1, P.mass));
    P.disp = Math.exp(lg + (lt - lg) * (1 - Math.exp(-dt * 4)));
    const pr = radiusForMass(P.disp) * (this.arena ? this.pSurge.scale : 1);
    const wantBoost = playing && this.playerAlive && (this.keys.has("space") || this.mouse.down || this.boostBtn) && Math.hypot(ix, iy) > 0.05;
    this.boosting = wantBoost && P.mass > BOOST.minMass;
    const maxSpeed = (this.arena ? MAX_SPEED : PLAYER.speedPerRadius * pr) * (this.boosting ? BOOST.mult : 1);
    if (this.boosting) {
      // boosting burns mass, shed as a glowing trail (slither.io)
      P.mass = Math.max(BOOST.minMass, P.mass * (1 - BOOST.costPerSec * dt));
      this.shedT -= dt;
      if (this.shedT <= 0) { this.shedT = 0.05; this.emit(P.x - P.vx * 0.05, P.y - P.vy * 0.05, 2, this.skin.glow, pr * this.cam.zoom * 0.18, 30); }
    }
    if (this.arena) steer(P, ix, iy, maxSpeed, dt);
    else {
      const rate = il > 0.05 ? PLAYER.accel : PLAYER.decel;
      const f = 1 - Math.exp(-dt * rate);
      P.vx += (ix * maxSpeed - P.vx) * f; P.vy += (iy * maxSpeed - P.vy) * f;
    }
    P.x += P.vx * dt; P.y += P.vy * dt;
    if (this.arena) { this.clampToArena(P); this.updateBots(dt); }
    if (playing && !this.movedSent) {
      this.movedDist += Math.hypot(P.vx, P.vy) * dt * this.cam.zoom;
      if (this.movedDist > 260) { this.movedSent = true; this.cb.onTutorial?.("moved"); }
    }

    const prevX = this.cam.x, prevY = this.cam.y;
    const cf = 1 - Math.exp(-dt * 6);
    this.cam.x += (P.x - this.cam.x) * cf; this.cam.y += (P.y - this.cam.y) * cf;
    const zt = this.zoomFor(P.disp);
    this.cam.zoom = Math.exp(Math.log(this.cam.zoom) + (Math.log(zt) - Math.log(this.cam.zoom)) * (1 - Math.exp(-dt * 2)));
    this.bgOff.x += (this.cam.x - prevX) * this.cam.zoom; this.bgOff.y += (this.cam.y - prevY) * this.cam.zoom;
    this.rebase();

    const gravR = pr * PLAYER.gravityMult;
    const vr = this.viewRadius();
    const z = this.cam.zoom;
    const botSenseRadius = this.arena ? this.bots.reduce((max, bot) => bot.alive ? Math.max(max, radiusForMass(bot.mass) * bot.surge.scale * PLAYER.gravityMult) : max, 0) : 0;
    let eligibleCount = 0;
    for (const b of this.bodies) {
      if (![b.x, b.y, b.vx, b.vy, b.r, b.mass, b.rot, b.spin, b.t, b.dur].every(Number.isFinite) || b.r <= 0 || b.mass <= 0 || b.dur <= 0) {
        if (import.meta.env.DEV) console.warn("Replacing invalid cosmic object", b.seed);
        b.dead = true; continue;
      }
      b.rot += b.spin * dt;
      if (b.absorbing) {
        if (b.absorber && !b.absorber.alive) { b.absorbing = false; b.absorber = null; b.vx = b.vy = 0; continue; }
        const owner = b.absorber ?? P;
        b.t += dt;
        const p = Math.min(1, b.t / b.dur);
        const e = p * p * (1.6 - 0.6 * p);
        const ang = b.a0 + b.dir * e * Math.PI * 1.6;
        const d = b.d0 * (1 - e);
        b.x = owner.x + Math.cos(ang) * d; b.y = owner.y + Math.sin(ang) * d;
        b.rot += b.dir * dt * 6 * e;
        b.trailT -= dt;
        if (b.kind.tier >= 1 && b.trailT <= 0) { b.trailT = 0.03; this.emit(b.x, b.y, 1, b.sprite?.tint ?? "#fff", b.r * z * 0.25, 20); }
        if (p >= 1 && !b.dead) this.consume(b);
        continue;
      }
      let owner: Bot | typeof P | null = this.playerAlive ? P : null;
      if (this.arena) {
        let nearest = owner && canAbsorb(effectiveMass(P.mass, this.arena ? this.pSurge.scale : 1), b.kind) ? Math.hypot(P.x - b.x, P.y - b.y) / pr : Infinity;
        const nearby: Bot[] = []; this.botGrid.query(b.x, b.y, botSenseRadius + b.r, nearby);
        for (const bot of nearby) if (bot.alive && canAbsorb(effectiveMass(bot.mass, bot.surge.scale), b.kind)) {
          const r = radiusForMass(bot.mass) * bot.surge.scale, d = Math.hypot(bot.x - b.x, bot.y - b.y);
          if (d < r * PLAYER.gravityMult + b.r && d / r < nearest) { owner = bot; nearest = d / r; }
        }
      }
      const target = owner ?? P;
      const ownerR = owner && "alive" in owner ? radiusForMass(owner.disp) * owner.surge.scale : pr;
      const ownerGrav = ownerR * PLAYER.gravityMult;
      const dx = target.x - b.x, dy = target.y - b.y;
      const d = Math.hypot(dx, dy) || 1e-9;
      b.eligible = !!owner && canAbsorb(effectiveMass(target.mass, owner && "surge" in owner ? owner.surge.scale : this.arena ? this.pSurge.scale : 1), b.kind);
      if (b.eligible) eligibleCount++;
      b.inField = !!owner && d < ownerGrav + b.r;
      if (b.inField && b.eligible) {
        if (playing && owner === P && !this.pulledSent) { this.pulledSent = true; this.cb.onTutorial?.("pulled"); }
        const closeness = 1 - Math.min(1, d / (ownerGrav + b.r));
        const a = 42 * ownerR * b.kind.pull * (0.4 + 2.6 * closeness * closeness);
        const nx = dx / d, ny = dy / d;
        b.vx += (nx * a - ny * a * 0.35) * dt; b.vy += (ny * a + nx * a * 0.35) * dt;
        b.vx *= 1 - Math.min(1, dt * 1.5); b.vy *= 1 - Math.min(1, dt * 1.5);
        if (d < ownerR * 0.95 + b.r * 0.35) {
          b.absorber = owner && "alive" in owner ? owner : null;
          b.absorbing = true; b.t = 0; b.a0 = Math.atan2(-dy, -dx); b.d0 = d;
          b.dir = (nx * b.vy - ny * b.vx) >= 0 ? -1 : 1;
          b.dur = b.kind.absorbTime;
        }
      } else {
        b.vx *= 1 - Math.min(1, dt * 0.2); b.vy *= 1 - Math.min(1, dt * 0.2);
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (this.arena) { if (Math.hypot(b.x, b.y) > this.worldR * 1.05) b.dead = true; }
      else if (d > vr * 2.4 + b.r || b.r * z < 0.5) b.dead = true;
    }
    if (this.bodies.some((b) => b.dead)) this.bodies = this.bodies.filter((b) => !b.dead);
    let n = 0;
    let localFood = -1;
    while (this.bodies.length < (this.arena ? ARENA.density : PLAYER.density) && n++ < 5) {
      if (this.arena) {
        if (localFood < 0) { localFood = 0; for (const b of this.bodies) if (!b.absorbing && canAbsorb(effectiveMass(P.mass, this.arena ? this.pSurge.scale : 1), b.kind) && Math.abs(b.x - P.x) < vr && Math.abs(b.y - P.y) < vr) localFood++; }
        this.spawnArenaFood(localFood++ < 25);
      } else this.spawn(false, eligibleCount < PLAYER.density * 0.45);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt;
      if (p.life <= 0) { this.pool.push(p); this.particles[i] = this.particles[this.particles.length - 1]; this.particles.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
    }
    this.rings = this.rings.filter((r) => (r.life += dt) < r.dur);
    this.texts = this.texts.filter((t) => (t.life += dt) < 1.3);
    if (this.texts.length > 6) this.texts = this.texts.slice(-6);
    this.shake *= Math.exp(-dt * 8); this.flash = Math.max(0, this.flash - dt * 2.5); this.pulse *= Math.exp(-dt * 4);
    if (!this.shooting && Math.random() < dt * 0.15) {
      const a = 0.4 + Math.random() * 0.5;
      this.shooting = { x: Math.random() * this.w, y: -20, vx: -Math.cos(a) * 700, vy: Math.sin(a) * 700, life: 1 };
    }
    if (this.shooting) { const s = this.shooting; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; if (s.life <= 0) this.shooting = null; }

    if (playing) {
      this.hudT -= dt;
      if (this.hudT <= 0) { this.hudT = 0.08; this.emitHud(); }
    } else if (P.mass > 6000) { P.mass = 300; this.topIdx = topEligibleIndex(300); }
  }

  emitHud() {
    const s = this.pSurge;
    const surgePhase = s.active ? "active" as const : s.cd > 0 ? "cooldown" as const : "ready" as const;
    const surgeProgress = s.active ? Math.max(0, 1 - s.t / SURGE.duration) : s.cd > 0 ? 1 - s.cd / SURGE.cooldown : 1;
    this.cb.onHud?.({ mass: this.player.mass, time: this.runTime, surgePhase, surgeProgress,
      surgeRemaining: s.active ? Math.max(0, SURGE.duration - s.t) : 0, surgeCooldown: s.cd });
  }

  private consume(b: Body) {
    if (b.dead) return;
    b.dead = true;
    const P = this.player;
    const kind = b.kind;
    const gain = Math.max(1, kind.mass < 1000 ? Math.round(b.mass) : b.mass);
    if (b.absorber) {
      if (b.absorber.alive) b.absorber.mass = addMass(b.absorber.mass, gain);
      this.emit(b.x, b.y, this.cfg.settings.reduced ? 2 : 8, b.absorber.skin.mid, 2, 80);
      return;
    }
    if (this.arena && !this.playerAlive) return;
    P.mass = addMass(P.mass, gain);
    const tint = b.sprite?.tint ?? "#bfefff";
    const playing = this.mode === "play";
    const red = this.cfg.settings.reduced;
    const z = this.cam.zoom;
    const prW = radiusForMass(P.mass);
    // relative size of the meal drives feedback strength
    const rel = Math.min(1, b.r / prW);
    const big = kind.tier >= 2 || rel > 0.45;
    if (kind.tier === 0 && rel < 0.4) {
      this.emit(P.x, P.y, red ? 2 : 5, tint, 2, 80);
      if (playing) sfx.absorbSmall();
    } else {
      this.emit(P.x, P.y, red ? 10 : big ? 60 : 28, tint, 3, big ? 420 : 240);
      this.rings.push({ x: P.x, y: P.y, r: prW, max: prW * (big ? 6 : 3.5), life: 0, dur: big ? 0.9 : 0.6, color: tint, width: big ? 6 : 3 });
      if (playing) { if (big) sfx.absorbStar(); else sfx.absorbPlanet(); }
      if (this.cfg.settings.shake) this.shake = Math.min(14, this.shake + (big ? 9 : 4));
      if (big) { this.flash = red ? 0.1 : 0.25; this.flashColor = tint; }
      this.pulse = big ? 1 : 0.5;
    }
    void z;
    if (playing) {
      this.texts.push({ text: `+${formatMass(gain)} MASS`, life: 0, color: tint, big: kind.tier >= 1 });
      if (kind.tier >= 1) this.texts.push({ text: kind.name, life: -0.05, color: "#ffffff", big: false });
      this.cb.onTutorial?.("absorbed");
      this.cb.onAbsorb?.(kind, gain, P.mass);
    }
    const nt = topEligibleIndex(P.mass);
    if (nt > this.topIdx) {
      for (let i = this.topIdx + 1; i <= nt; i++) if (playing) this.cb.onToast?.(`${kindAt(i).plural} can now be absorbed`);
      this.topIdx = nt;
      this.rings.push({ x: P.x, y: P.y, r: prW, max: prW * 5, life: 0, dur: 0.8, color: this.skin.mid, width: 4 });
      if (playing) this.updateEra();
    }
  }

  private emit(x: number, y: number, n: number, color: string, size: number, speed: number) {
    const limit = this.cfg.settings.reduced ? 140 : MAX_PARTICLES;
    for (let i = 0; i < n && this.particles.length < limit; i++) {
      const p = this.pool.pop() ?? ({} as Particle);
      const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7) / Math.max(0.3, this.cam.zoom);
      p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.max = p.life = 0.4 + Math.random() * 0.6; p.size = size * (0.5 + Math.random()); p.color = color;
      this.particles.push(p);
    }
  }

  // ---------- background ----------
  private buildStars() {
    const layers = [{ n: 260, s: 0.8, a: 0.5 }, { n: 120, s: 1.3, a: 0.75 }, { n: 45, s: 2, a: 1 }];
    this.starTiles = layers.map((L, li) => {
      const c = document.createElement("canvas"); c.width = c.height = 1024;
      const x = c.getContext("2d"); if (!x) throw new Error("Canvas rendering is unavailable"); const r = rng(li * 77 + 3);
      if (li === 0) { // distant galaxies
        for (let g = 0; g < 3; g++) {
          const gx = r() * 1024, gy = r() * 1024, gr = 20 + r() * 30;
          x.save(); x.translate(gx, gy); x.rotate(r() * 3); x.scale(1, 0.35);
          const grd = x.createRadialGradient(0, 0, 0, 0, 0, gr); grd.addColorStop(0, "rgba(220,200,255,0.35)"); grd.addColorStop(1, "rgba(120,100,255,0)");
          x.fillStyle = grd; x.beginPath(); x.arc(0, 0, gr, 0, TAU); x.fill(); x.restore();
        }
      }
      for (let i = 0; i < L.n; i++) {
        const hue = r() < 0.2 ? "200,220,255" : r() < 0.1 ? "255,220,200" : "255,255,255";
        x.fillStyle = `rgba(${hue},${L.a * (0.3 + r() * 0.7)})`;
        const sz = L.s * (0.4 + r() * 0.8);
        x.beginPath(); x.arc(r() * 1024, r() * 1024, sz, 0, TAU); x.fill();
        if (li === 2 && r() < 0.3) { x.fillStyle = `rgba(${hue},0.12)`; x.beginPath(); x.arc(r() * 1024, r() * 1024, sz * 4, 0, TAU); x.fill(); }
      }
      return c;
    });
  }
  private buildNebula(hues: [number, number]) {
    const key = hues.join(","); if (key === this.nebulaHues && this.nebula) return;
    this.nebulaHues = key;
    const c = this.nebula ?? document.createElement("canvas"); c.width = c.height = 1024;
    const x = c.getContext("2d"); if (!x) return; x.clearRect(0, 0, 1024, 1024);
    const r = rng(hues[0] * 13 + hues[1]);
    for (let i = 0; i < 14; i++) {
      const h = i % 2 ? hues[0] : hues[1];
      const cx = r() * 1024, cy = r() * 1024, rad = 150 + r() * 300;
      for (const [ox, oy] of [[0, 0], [1024, 0], [-1024, 0], [0, 1024], [0, -1024]]) {
        const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
        g.addColorStop(0, `hsla(${h},80%,55%,${0.08 + r() * 0.06})`); g.addColorStop(1, `hsla(${h},80%,40%,0)`);
        x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
      }
    }
    this.nebula = c;
  }
  private tile(img: HTMLCanvasElement, factor: number, alpha: number) {
    const ctx = this.ctx; const S = 1024;
    const ox = ((-this.bgOff.x * factor) % S + S) % S, oy = ((-this.bgOff.y * factor) % S + S) % S;
    ctx.globalAlpha = alpha;
    for (let x = ox - S; x < this.w; x += S) for (let y = oy - S; y < this.h; y += S) ctx.drawImage(img, x, y);
    ctx.globalAlpha = 1;
  }

  // ---------- render ----------
  render() {
    const ctx = this.ctx; const { w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, w * 0.4, h);
    bg.addColorStop(0, "#05041a"); bg.addColorStop(0.6, "#0a0828"); bg.addColorStop(1, "#02020c");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if (this.nebula) this.tile(this.nebula, 0.05, 1);
    this.tile(this.starTiles[0], 0.08, 1);
    this.tile(this.starTiles[1], 0.2, 1);
    if (this.shooting) {
      const s = this.shooting; const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 0.12, s.y - s.vy * 0.12);
      g.addColorStop(0, `rgba(255,255,255,${s.life})`); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.12, s.y - s.vy * 0.12); ctx.stroke();
    }
    this.tile(this.starTiles[2], 0.45, 1);

    const z = this.cam.zoom;
    const sx = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake : 0;
    const cx = w / 2 - this.cam.x * z + sx, cy = h / 2 - this.cam.y * z + sy;
    const P = this.player; const pr = radiusForMass(P.disp) * (this.arena ? this.pSurge.scale : 1);
    const px = cx + P.x * z, py = cy + P.y * z;
    const gravR = pr * PLAYER.gravityMult;
    const red = this.cfg.settings.reduced;
    const t = this.time;
    const prS = pr * z;

    ctx.strokeStyle = this.skin.mid; ctx.globalAlpha = 0.12; ctx.lineWidth = 1;
    ctx.setLineDash([4, 10]); ctx.lineDashOffset = -t * 20;
    ctx.beginPath(); ctx.arc(px, py, gravR * z, 0, TAU); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    for (const b of this.bodies) {
      const playerEligible = canAbsorb(effectiveMass(P.mass, this.arena ? this.pSurge.scale : 1), b.kind);
      let bx = cx + b.x * z, by = cy + b.y * z;
      const pad = b.sprite ? b.sprite.pad : 3;
      const br = b.r * z;
      if (![bx, by, br].every(Number.isFinite) || br <= 0) continue;
      if (bx < -br * pad || bx > w + br * pad || by < -br * pad || by > h + br * pad) continue;
      let scale = 1, stretch = 0;
      const dpx = px - bx, dpy = py - by; const dd = Math.hypot(dpx, dpy) || 1;
      if (b.absorbing) { const p = Math.min(1, b.t / b.dur); scale = 1 - 0.92 * p * p; stretch = 0.6 * p; }
      else if (b.inField && playerEligible) stretch = 0.25 * Math.max(0, 1 - Math.min(1, dd / (gravR * z)));
      else if (!playerEligible && dd < gravR * z * 0.9) { const k = 1 - dd / (gravR * z * 0.9); bx += Math.sin(t * 28 + b.seed) * br * 0.05 * k; by += Math.cos(t * 23 + b.seed) * br * 0.05 * k; }
      const ang = Math.atan2(dpy, dpx);
      if (!b.sprite) {
        const rr = Math.max(0.9, br * scale);
        ctx.fillStyle = b.seed % 3 ? "#bdf3ff" : "#ffffff";
        if (!red) { ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(bx, by, rr * 2.6, 0, TAU); ctx.fill(); }
        ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.arc(bx, by, rr, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        if (b.absorbing || (b.inField && b.eligible)) {
          ctx.strokeStyle = "#bdf3ff"; ctx.globalAlpha = 0.4; ctx.lineWidth = rr;
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(ang) * rr * 5, by - Math.sin(ang) * rr * 5); ctx.stroke(); ctx.globalAlpha = 1;
        }
      } else {
        const s = b.sprite; const k = (b.r / s.R) * z * scale;
        ctx.save(); ctx.translate(bx, by);
        if (stretch > 0) { ctx.rotate(ang); ctx.scale(1 + stretch, 1 - stretch * 0.45); ctx.rotate(-ang); }
        if (b.kind.tier >= 2 && !red) this.starFx(b, k * s.R, t);
        ctx.rotate(b.rot);
        const size = s.c.width * k;
        ctx.drawImage(s.c, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      if (!b.absorbing && b.sprite) {
        if (!playerEligible && dd < gravR * z * 1.4 + br) {
          const rr = br * 1.25 + 4;
          ctx.strokeStyle = "rgba(255,120,140,0.6)"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 5]);
          ctx.beginPath(); ctx.arc(bx, by, rr, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
          this.lock(bx + rr * 0.72, by - rr * 0.72, Math.max(7, Math.min(12, br * 0.35)));
        } else if (playerEligible && (b.inField || (this.highlight && dd < Math.min(w, h) * 0.5))) {
          const pulse = this.highlight ? 0.5 + 0.5 * Math.sin(t * 6) : 0.5;
          ctx.strokeStyle = this.skin.mid; ctx.globalAlpha = 0.3 + 0.4 * pulse; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(bx, by, br * 1.2 + 3, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
        }
      } else if (this.highlight && b.eligible && !b.sprite && dd < Math.min(w, h) * 0.45) {
        ctx.strokeStyle = this.skin.mid; ctx.globalAlpha = 0.4 + 0.4 * Math.sin(t * 6); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(bx, by, 7, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }

    for (const r of this.rings) {
      const p = r.life / r.dur; const rad = (r.r + (r.max - r.r) * (1 - Math.pow(1 - p, 3))) * z;
      if (![r.x, r.y, rad, p].every(Number.isFinite) || rad <= 0) continue;
      ctx.strokeStyle = r.color; ctx.globalAlpha = (1 - p) * 0.8; ctx.lineWidth = r.width * (1 - p) + 0.5;
      ctx.beginPath(); ctx.arc(cx + r.x * z, cy + r.y * z, rad, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      if (![p.x, p.y, p.life, p.max, p.size].every(Number.isFinite) || p.max <= 0 || p.size <= 0) continue;
      ctx.globalAlpha = p.life / p.max; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(cx + p.x * z, cy + p.y * z, Math.max(0.6, p.size), 0, TAU); ctx.fill();
    }
    // grandeur: orbiting swirl and lensing ring scale with how far the player has grown
    const grand = Math.min(1, this.topIdx / 14);
    if (!red && grand > 0) {
      const n = Math.floor(8 + 32 * grand);
      for (let i = 0; i < n; i++) {
        const rr = prS * (1.6 + ((i * 0.618) % 1) * 2.2 * (0.6 + grand));
        const a = t * (1.6 / (1 + (rr / prS) * 0.4)) + i * 2.399;
        ctx.globalAlpha = 0.25 + 0.5 * grand * ((i % 3) / 3);
        ctx.fillStyle = i % 2 ? this.skin.mid : this.skin.outer;
        ctx.beginPath(); ctx.arc(px + Math.cos(a) * rr, py + Math.sin(a) * rr * 0.55, 1 + grand * 1.5, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 0.15 * grand; ctx.strokeStyle = this.skin.hot; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, prS * (3 + 0.15 * Math.sin(t * 1.5)), 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;

    if (this.arena) {
      ctx.strokeStyle = this.skin.outer; ctx.globalAlpha = 0.35; ctx.lineWidth = 2;
      ctx.setLineDash([12, 12]); ctx.beginPath(); ctx.arc(cx, cy, this.worldR * z, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      for (const bot of this.bots) {
        if (!bot.alive && !bot.dying) continue;
        const bx = cx + bot.x * z, by = cy + bot.y * z;
        const r = radiusForMass(bot.disp) * bot.surge.scale * z * (bot.dying ? Math.max(0.06, 1 - bot.dieT / bot.dieDur) : 1);
        if (bx < -r * 4 || bx > w + r * 4 || by < -r * 4 || by > h + r * 4) continue;
        drawBlackHole(ctx, bx, by, r, t + bot.wob, bot.skin, red, 0, (bot.surge.scale - 1) / (SURGE.radiusMult - 1));
        if (bot.alive && r > 2) this.surgeAura(bx, by, r, bot.surge, bot.skin.hot);
        if (bot.alive && r > 3) {
          ctx.textAlign = "center"; ctx.font = "600 11px Sora, system-ui, sans-serif";
          ctx.fillStyle = bot.skin.mid; ctx.fillText(bot.name, bx, by - r * 2 - 6);
        }
      }
    }
    const playerScale = this.arena && !this.playerAlive ? Math.max(0.02, 1 - this.playerDieT / 0.65) : 1;
    drawBlackHole(ctx, px, py, prS * playerScale * (1 + this.pulse * 0.06), t, this.skin, red, this.pulse * 0.6 + grand * 0.8, (this.pSurge.scale - 1) / (SURGE.radiusMult - 1));
    if (this.arena && this.playerAlive) this.surgeAura(px, py, prS, this.pSurge, this.skin.hot);
    if (this.arena && this.playerAlive) { ctx.textAlign = "center"; ctx.font = "700 12px Sora, system-ui, sans-serif"; ctx.fillStyle = this.skin.hot; ctx.fillText("You", px, py - prS * 2 - 8); }

    ctx.textAlign = "center";
    for (const tx of this.texts) {
      if (tx.life < 0) continue;
      const p = tx.life / 1.3;
      ctx.globalAlpha = 1 - p * p;
      ctx.font = `${tx.big ? 700 : 600} ${tx.big ? 20 : 13}px Sora, system-ui, sans-serif`;
      ctx.fillStyle = tx.color;
      const off = tx.big ? 0 : 18;
      ctx.fillText(tx.text, px, py - prS * 1.6 - 14 - p * 40 + off);
    }
    ctx.globalAlpha = 1;
    if (this.flash > 0) { ctx.fillStyle = this.flashColor; ctx.globalAlpha = this.flash * 0.5; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,10,0.55)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  }

  private starFx(b: Body, R: number, t: number) {
    if (!Number.isFinite(R) || R <= 0 || !Number.isFinite(t)) return;
    const ctx = this.ctx;
    if (b.kind.style === "star") {
      const tint = b.sprite?.tint ?? this.skin.mid;
      ctx.save(); ctx.rotate(t * 0.15 + b.seed);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 8; i++) {
        ctx.rotate(TAU / 8);
        const len = R * (2.1 + 0.4 * Math.sin(t * 2 + i));
        const g = ctx.createLinearGradient(0, 0, len, 0); g.addColorStop(0, tint + "66"); g.addColorStop(1, tint + "00");
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -R * 0.12); ctx.lineTo(len, 0); ctx.lineTo(0, R * 0.12); ctx.fill();
      }
      ctx.restore(); ctx.globalCompositeOperation = "source-over";
    } else if (b.kind.style === "neutron") {
      ctx.save(); ctx.rotate(t * 2.2 + b.seed); ctx.globalCompositeOperation = "lighter";
      for (const dir of [1, -1]) {
        const g = ctx.createLinearGradient(0, 0, 0, dir * R * 6); g.addColorStop(0, "rgba(160,220,255,0.7)"); g.addColorStop(1, "rgba(160,220,255,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-R * 0.3, 0); ctx.lineTo(-R * 0.9, dir * R * 6); ctx.lineTo(R * 0.9, dir * R * 6); ctx.lineTo(R * 0.3, 0); ctx.fill();
      }
      ctx.restore(); ctx.globalCompositeOperation = "source-over";
    } else if (b.kind.style === "relic") {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = b.sprite?.tint ?? this.skin.mid; ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R * (1.3 + 0.1 * Math.sin(t * 2)), 0, TAU); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    }
  }

  private lock(x: number, y: number, s: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(20,8,30,0.85)"; ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#ff8ca0"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x, y - s * 0.15, s * 0.3, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = "#ff8ca0"; ctx.fillRect(x - s * 0.42, y - s * 0.12, s * 0.84, s * 0.6);
  }
}
