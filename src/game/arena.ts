// AI Arena: bot identities, personalities, steering decisions, leaderboard, spatial index.
// Pure logic — no DOM, no networking. All opponents are simulated locally in the browser.
import { SKINS, type Skin } from "./data";

export type Personality = "aggressive" | "explorer" | "collector" | "competitive" | "sneaky" | "balanced";

export interface Bot {
  id: number;
  name: string;
  skin: Skin;
  x: number; y: number; vx: number; vy: number;
  mass: number;
  /** Smoothed display mass so growth animates instead of jumping. */
  disp: number;
  personality: Personality;
  /** Movement speed multiplier (0.8–1.15). */
  speed: number;
  skill?: number;
  /** Seconds until the next AI decision (staggered for performance). */
  thinkT: number;
  mode: "wander" | "food" | "hunt" | "flee";
  /** Steering target. */
  tx: number; ty: number;
  /** Body the bot is currently trying to eat (engine-owned reference). */
  foodRef: unknown;
  alive: boolean;
  respawnT: number;
  dying: boolean; dieT: number; dieDur: number;
  eater: Bot | "player" | null;
  /** Wobble phase for organic movement. */
  wob: number;
  /** Core-strike ability state. */
  strike: StrikeState;
}

export const ARENA = {
  worldRadius: 3600,
  /** Cosmic bodies kept alive across the whole arena. */
  density: 1400,
  respawnMin: 3,
  respawnMax: 6,
  /** A hole must be this much more massive to eat another hole. */
  eatRatio: 1.4,
  contactTime: 0.28,
  spawnGrace: 4,
  growthFactor: 0.4,
  eliminationGain: 0.45,
  dropFraction: 0.35,
  population: 100,
  /** Food sense radius = bot radius × this. */
  senseMult: 11,
} as const;

export const BOT_COUNT_OPTIONS = [25, 50, 75, 100];

/** Stable world-space speed: large holes lose only a bounded amount of agility. */
export function movementSpeed(mass: number) {
  return 65 * (0.7 + 0.3 / (1 + Math.log10(Math.max(10, mass) / 10) * 0.6));
}

/** Shared radius-relative pace: bigger holes move proportionally slower (hole.io weight). */
export function paceFactor(mass: number) {
  return 0.55 / (1 + Math.log10(Math.max(1, mass / 10)) * 0.2);
}

/** Identical maximum world speed for every participant at every mass. */
export const MAX_SPEED = 95;

export const BOOST = { mult: 1.65, costPerSec: 0.025, minMass: 25 } as const;

// ---------- core strike: skill-based combat that lets small holes beat big ones ----------
export const STRIKE = {
  /** Telegraphed wind-up; the attacker is slowed and glows. */
  charge: 0.55,
  /** Lunge window in which the strike can connect. */
  active: 0.3,
  cooldown: 6,
  /** A missed strike leaves the attacker eatable by anyone for this long. */
  vulnerable: 1.4,
  /** Hit when the attacker's centre reaches this fraction of the defender's radius. */
  coreFrac: 0.5,
  /** Lunge speed multiplier during the active window. */
  lungeMult: 2.1,
  /** Repeat eliminations of the same victim within this many seconds pay half. */
  farmWindow: 45,
} as const;

export type StrikePhase = "ready" | "charge" | "active" | "cooldown";
export interface StrikeState { phase: StrikePhase; t: number; cd: number; vuln: number; dirX: number; dirY: number; }
export const newStrike = (): StrikeState => ({ phase: "ready", t: 0, cd: 0, vuln: 0, dirX: 1, dirY: 0 });

/** Begin the charge-up if the ability is ready and the attacker is not vulnerable. */
export function tryStrike(s: StrikeState, dirX: number, dirY: number): boolean {
  if (s.phase !== "ready" || s.vuln > 0) return false;
  const d = Math.hypot(dirX, dirY);
  if (d > 0.1) { s.dirX = dirX / d; s.dirY = dirY / d; }
  s.phase = "charge"; s.t = 0;
  return true;
}

/** Advance the strike machine. Returns "fired" when the lunge begins, "whiffed" when a miss ends. */
export function tickStrike(s: StrikeState, dt: number): "fired" | "whiffed" | null {
  s.cd = Math.max(0, s.cd - dt);
  s.vuln = Math.max(0, s.vuln - dt);
  if (s.phase === "ready") return null;
  s.t += dt;
  if (s.phase === "charge" && s.t >= STRIKE.charge) { s.phase = "active"; s.t = 0; return "fired"; }
  if (s.phase === "active" && s.t >= STRIKE.active) {
    s.phase = "cooldown"; s.t = 0; s.cd = STRIKE.cooldown; s.vuln = STRIKE.vulnerable;
    return "whiffed";
  }
  if (s.phase === "cooldown" && s.cd <= 0) { s.phase = "ready"; s.t = 0; }
  return null;
}

/** A connected strike goes on cooldown without the vulnerability penalty. */
export function strikeConnected(s: StrikeState) {
  if (s.phase === "active" || s.phase === "charge") { s.phase = "cooldown"; s.t = 0; s.cd = STRIKE.cooldown; }
}

/** The strike connects when the attacker's centre reaches the defender's exposed core. */
export function strikeHits(ax: number, ay: number, dx: number, dy: number, defenderRadius: number): boolean {
  return Number.isFinite(defenderRadius) && defenderRadius > 0 &&
    Math.hypot(ax - dx, ay - dy) <= defenderRadius * STRIKE.coreFrac;
}

/**
 * Elimination payout: a fraction of the victim's mass, never 100%.
 * Defeating a much larger opponent pays a bonus; repeat-farming the same victim pays half.
 */
export function eliminationReward(victimMass: number, attackerMass: number, farmed: boolean): number {
  if (!Number.isFinite(victimMass) || victimMass <= 0) return 0;
  const ratioBonus = Math.min(0.25, 0.125 * Math.log10(Math.max(1, victimMass / Math.max(1, attackerMass))));
  const frac = Math.min(0.8, ARENA.eliminationGain + ratioBonus) * (farmed ? 0.5 : 1);
  return Math.max(1, victimMass * frac);
}

/** Same exponential acceleration and bounded turning for every arena participant. */
export function steer(o: { vx: number; vy: number }, x: number, y: number, speed: number, dt: number) {
  const input = Math.min(1, Math.hypot(x, y));
  const current = Math.hypot(o.vx, o.vy);
  if (input < 0.03) {
    const damping = Math.exp(-dt * 4); o.vx *= damping; o.vy *= damping; return;
  }
  const target = Math.atan2(y, x);
  const angle = current > 0.1 ? Math.atan2(o.vy, o.vx) : target;
  const delta = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
  const turn = 3.2 * dt;
  const heading = angle + Math.max(-turn, Math.min(turn, delta));
  const velocity = current + (speed * input - current) * (1 - Math.exp(-dt * 3));
  o.vx = Math.cos(heading) * velocity; o.vy = Math.sin(heading) * velocity;
}

export const PERSONALITIES: Record<
  Personality,
  { hunt: number; food: number; flee: number; wander: number; mistake: number; react: [number, number] }
> = {
  aggressive: { hunt: 0.9, food: 0.5, flee: 0.55, wander: 0.2, mistake: 0.1, react: [0.15, 0.35] },
  explorer: { hunt: 0.25, food: 0.6, flee: 0.7, wander: 0.9, mistake: 0.12, react: [0.25, 0.5] },
  collector: { hunt: 0.15, food: 1.0, flee: 0.7, wander: 0.3, mistake: 0.1, react: [0.2, 0.45] },
  competitive: { hunt: 0.7, food: 0.6, flee: 0.8, wander: 0.3, mistake: 0.06, react: [0.12, 0.3] },
  sneaky: { hunt: 0.2, food: 0.7, flee: 1.0, wander: 0.5, mistake: 0.08, react: [0.2, 0.4] },
  balanced: { hunt: 0.5, food: 0.7, flee: 0.7, wander: 0.5, mistake: 0.12, react: [0.2, 0.45] },
};
export const PERSONALITY_LIST = Object.keys(PERSONALITIES) as Personality[];

const NAME_A = ["Nova", "Void", "Galaxy", "Cosmic", "Star", "Nebula", "Quasar", "Astro", "Lunar", "Solar", "Dark", "Hyper", "Omega", "Zero", "Echo", "Flux", "Astra", "Pulsar", "Comet", "Orbit"];
const NAME_B = ["King", "Hunter", "Eater", "Lord", "Walker", "Drift", "Prime", "Reaper", "Wolf", "Fox", "Byte", "Storm", "Shadow", "Blaze", "Titan", "Wisp", "Rider", "Maw", "Sage", "Ghost"];

/** Unique randomized arena names like "NovaKing" or "VoidHunter". */
export function makeBotName(rand: () => number, used: Set<string>): string {
  for (let i = 0; i < 40; i++) {
    const n = NAME_A[Math.floor(rand() * NAME_A.length)] + NAME_B[Math.floor(rand() * NAME_B.length)];
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  let n = "";
  do {
    n = "Drifter" + Math.floor(rand() * 1000);
  } while (used.has(n));
  used.add(n);
  return n;
}

export function pickPersonality(rand: () => number): Personality {
  return PERSONALITY_LIST[Math.floor(rand() * PERSONALITY_LIST.length) % PERSONALITY_LIST.length];
}

/** Log-uniform starting mass: most bots near the player, a few far stronger. */
export function botStartMass(rand: () => number, playerMass: number): number {
  const lo = Math.log(6);
  const hi = Math.log(Math.max(60, playerMass * 40));
  return Math.min(400, Math.max(6, Math.exp(lo + rand() * (hi - lo))));
}

/** A black hole can eat another hole only when clearly more massive. */
export function canEat(attackerMass: number, victimMass: number): boolean {
  return attackerMass / victimMass >= ARENA.eatRatio;
}

/** Best valid spawn in an inset disc, even when complete separation is impossible. */
export function spawnPosAwayFrom(rand: () => number, px: number, py: number, minDist: number, worldR: number, opponentRadius = 0, margin = 0) {
  const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;
  px = finite(px); py = finite(py);
  const radius = Math.max(0, finite(worldR) - Math.max(0, finite(opponentRadius)) - Math.max(0, finite(margin)));
  if (radius === 0) return { x: 0, y: 0 };
  const distance = Math.hypot(px, py);
  const required = Math.min(Math.max(0, finite(minDist, distance + radius)), distance + radius);
  const sample = () => Math.max(0, Math.min(1, finite(rand(), 0.5)));
  for (let i = 0; i < 24; i++) {
    const a = sample() * Math.PI * 2;
    const d = Math.sqrt(sample()) * radius;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    // Prefer the player's opposite hemisphere when there is room to choose.
    if (Math.hypot(x - px, y - py) >= required && (distance === 0 || x * px + y * py <= 0)) return { x, y };
  }
  if (distance > 0) return { x: -(px / distance) * radius || 0, y: -(py / distance) * radius || 0 };
  return { x: -radius || 0, y: 0 };
}

export interface BotSenses {
  threat: { x: number; y: number } | null;
  prey: { x: number; y: number } | null;
  food: { x: number; y: number } | null;
}

/** Choose a steering target from what the bot senses. Personality weights the choice; mistakes happen. */
export function decide(bot: Bot, s: BotSenses, rand: () => number, worldR: number) {
  const P = PERSONALITIES[bot.personality];
  // drift back toward the middle near the world edge
  if (Math.hypot(bot.x, bot.y) > worldR * 0.92) {
    bot.mode = "wander";
    bot.tx = -bot.x * 0.4;
    bot.ty = -bot.y * 0.4;
    return;
  }
  if (s.threat && rand() < P.flee * (1 - P.mistake)) {
    bot.mode = "flee";
    const dx = bot.x - s.threat.x;
    const dy = bot.y - s.threat.y;
    const d = Math.hypot(dx, dy) || 1;
    bot.tx = bot.x + (dx / d) * 1500;
    bot.ty = bot.y + (dy / d) * 1500;
    return;
  }
  if (s.prey && rand() < P.hunt * (1 - P.mistake)) {
    bot.mode = "hunt";
    bot.tx = s.prey.x;
    bot.ty = s.prey.y;
    return;
  }
  if (s.food && rand() < P.food) {
    bot.mode = "food";
    bot.tx = s.food.x;
    bot.ty = s.food.y;
    return;
  }
  if (bot.mode !== "wander" || Math.hypot(bot.tx - bot.x, bot.ty - bot.y) < 250 || rand() < P.wander * 0.1) {
    bot.mode = "wander";
    const a = rand() * Math.PI * 2;
    const d = 700 + rand() * 2000;
    bot.tx = bot.x + Math.cos(a) * d;
    bot.ty = bot.y + Math.sin(a) * d;
  }
}

export interface LeaderEntry {
  name: string;
  mass: number;
  isPlayer: boolean;
}

/** Top 10 by mass plus the player's overall rank. */
export function computeLeaderboard(bots: { name: string; mass: number; alive: boolean }[], playerMass: number, playerAlive: boolean, playerName = "You") {
  const entries: LeaderEntry[] = [];
  for (const b of bots) if (b.alive) entries.push({ name: b.name, mass: b.mass, isPlayer: false });
  if (playerAlive) entries.push({ name: playerName, mass: playerMass, isPlayer: true });
  entries.sort((a, b) => b.mass - a.mass);
  const idx = entries.findIndex((e) => e.isPlayer);
  return { leaders: entries.slice(0, 10), rank: idx < 0 ? entries.length + 1 : idx + 1 };
}

/** Uniform-grid spatial index so bots only compare against nearby objects. */
export class SpatialGrid<T extends { x: number; y: number }> {
  private map = new Map<string, T[]>();
  constructor(public cell: number) {}
  private key(cx: number, cy: number) {
    return `${cx},${cy}`;
  }
  clear() {
    this.map.clear();
  }
  insert(o: T) {
    const k = this.key(Math.floor(o.x / this.cell), Math.floor(o.y / this.cell));
    const a = this.map.get(k);
    if (a) a.push(o);
    else this.map.set(k, [o]);
  }
  /** Append all objects in cells overlapping the square (x±r, y±r) to `out`. */
  query(x: number, y: number, r: number, out: T[]) {
    if (![x, y, r].every(Number.isFinite) || r < 0) return;
    const x0 = Math.floor((x - r) / this.cell);
    const x1 = Math.floor((x + r) / this.cell);
    const y0 = Math.floor((y - r) / this.cell);
    const y1 = Math.floor((y + r) / this.cell);
    // Huge holes can sense the entire world: don't iterate billions of empty cells.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.map.size) {
      for (const [key, objects] of this.map) {
        const [cx, cy] = key.split(",").map(Number);
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) out.push(...objects);
      }
      return out;
    }
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const a = this.map.get(this.key(cx, cy));
        if (a) for (const o of a) out.push(o);
      }
    return out;
  }
}

export function randomSkin(rand: () => number): Skin {
  return SKINS[Math.floor(rand() * SKINS.length) % SKINS.length];
}
