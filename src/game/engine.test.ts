import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "./engine";
import { PLAYER, kindAt } from "./data";
import { ARENA, dodgeTarget, newStrike, tryStrike } from "./arena";
import { MAX_RADIUS, addMass, radiusForMass } from "./logic";

vi.mock("./audio", () => ({ sfx: new Proxy({}, { get: () => vi.fn() }) }));
vi.mock("./sprites", () => ({ getSprite: () => null, VARIANTS: 4, rng: () => () => 0.5 }));
const gradient = { addColorStop: vi.fn() };
const ctx = new Proxy({}, { get: (_target, key) => key === "createRadialGradient" || key === "createLinearGradient" ? () => gradient : () => {} });
const tick = (e: Engine, seconds: number) => {
  for (let t = 0; t < seconds && !e.paused; t += 1 / 60) (e as unknown as { update: (dt: number) => void }).update(1 / 60);
};
let engine: Engine;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", () => 0); vi.stubGlobal("cancelAnimationFrame", () => {});
  engine = new Engine(document.createElement("canvas"), {});
});
afterEach(() => { engine.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("arena simulation", () => {
  it.each([10000, 50000, 100000, 150000, 200000, 500000, 1e6, 1e7, 1e8, 1e9])("keeps respawning, collecting and rendering at %s mass", (mass) => {
    engine.startArena(10);
    engine.player.mass = engine.player.disp = mass;
    engine.cam.zoom = engine.zoomFor(mass);
    engine.player.x = engine.worldR;
    const bot = engine.bots[0]; bot.alive = false; bot.dying = false; bot.respawnT = 0;
    const body = engine.bodies[0]; body.kind = kindAt(0); body.mass = 1;
    body.absorbing = true; body.absorber = null; body.t = body.dur;
    engine.bodies = [body];
    const hud = vi.fn(); engine.cb.onArena = hud;
    tick(engine, 1 / 60);
    expect(bot.alive).toBe(true);
    expect(Math.hypot(bot.x, bot.y) + radiusForMass(bot.mass) + 24).toBeLessThanOrEqual(engine.worldR + 1e-6);
    expect(engine.player.mass).toBe(mass + 1);
    expect(engine.cam.zoom).toBeGreaterThanOrEqual(Math.min(engine.w, engine.h) / (ARENA.worldRadius * 6));
    expect(hud.mock.lastCall?.[0].rank).toBe(1);
    expect(() => engine.render()).not.toThrow();
    const before = engine.time; tick(engine, 0.1); expect(engine.time).toBeGreaterThan(before);
    expect(engine.bodies.every(b => Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true);
  });
  it("smoothly approaches the zoom floor without capping mass or visually shrinking huge holes", () => {
    const masses = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9];
    const zooms = masses.map(m => engine.zoomFor(m));
    for (let i = 1; i < masses.length; i++) {
      expect(zooms[i]).toBeGreaterThanOrEqual(Math.min(engine.w, engine.h) / (ARENA.worldRadius * 6));
      expect(radiusForMass(masses[i]) * zooms[i]).toBeGreaterThanOrEqual(radiusForMass(masses[i - 1]) * zooms[i - 1]);
    }
    engine.startArena(10); engine.player.mass = 1e9;
    const before = engine.cam.zoom; tick(engine, 1 / 60);
    expect(engine.cam.zoom).toBeLessThan(before);
    expect(engine.cam.zoom).toBeGreaterThan(engine.zoomFor(engine.player.disp));
  });
  it("recovers invalid opponents without changing player mass or blocking later opponents", () => {
    engine.startArena(10); engine.player.mass = engine.player.disp = 1e6;
    engine.bots[0].x = NaN; engine.bots[0].mass = Infinity;
    const other = engine.bots[1]; other.alive = false; other.respawnT = 0;
    tick(engine, 1 / 60);
    expect(engine.bots[0].alive).toBe(true); expect(other.alive).toBe(true);
    expect(Number.isFinite(engine.bots[0].mass)).toBe(true);
    expect(engine.player.mass).toBe(1e6);
  });
  it("schedules the next frame while still surfacing unrelated programming errors", () => {
    const scheduled = vi.fn(() => 1); vi.stubGlobal("requestAnimationFrame", scheduled);
    vi.spyOn(engine, "render").mockImplementation(() => { throw new Error("Unrelated bug"); });
    expect(() => engine.loop(performance.now())).toThrow("Unrelated bug");
    expect(scheduled).toHaveBeenCalledWith(engine.loop);
  });
  it("starts with 100 distinct AI opponents plus the player", () => {
    const onArena = vi.fn(); engine.cb.onArena = onArena; engine.startArena();
    expect(engine.bots).toHaveLength(100);
    expect(new Set(engine.bots.map((b) => b.name)).size).toBe(100);
    expect(engine.bots.every((b) => Math.hypot(b.x, b.y) >= engine.viewRadius() * 0.55)).toBe(true);
    expect(onArena.mock.lastCall?.[0].alive).toBe(101);
  });
  it("moves bots independently and freezes simulation on pause", () => {
    engine.startArena(25); const bot = engine.bots[0];
    const x = bot.x, y = bot.y; tick(engine, 0.5);
    expect(Math.hypot(bot.x - x, bot.y - y)).toBeGreaterThan(0);
    engine.pause(); const time = engine.time; engine.loop(performance.now() + 20);
    expect(engine.time).toBe(time);
  });
  it("awards food to its bot owner once, never to the player", () => {
    engine.startArena(25); const bot = engine.bots[0], body = engine.bodies[0];
    body.kind = kindAt(0); body.mass = 1; body.absorber = bot;
    const before = bot.mass, playerMass = engine.player.mass;
    const consume = (engine as unknown as { consume: (b: typeof body) => void }).consume.bind(engine);
    consume(body); consume(body);
    expect(bot.mass).toBe(before + 1); expect(engine.player.mass).toBe(playerMass);
  });
  it("absorbs another bot once and respawns it after the delay", () => {
    engine.startArena(10);
    engine.bodies = []; engine.player.x = engine.worldR; engine.player.y = 0;
    for (const b of engine.bots) { b.x = -engine.worldR * 0.7; b.y = b.id * 100; b.mass = b.disp = 10; }
    const attacker = engine.bots[0], victim = engine.bots[1];
    attacker.mass = attacker.disp = 100; attacker.x = attacker.y = victim.x = victim.y = 0;
    tick(engine, 0.7);
    expect(victim.alive).toBe(false); expect(attacker.mass).toBeGreaterThanOrEqual(104.5); expect(attacker.mass).toBeLessThan(110);
    tick(engine, 6.5); expect(victim.alive).toBe(true);
  });
  it("eliminates the player, pauses, and emits the killer once", () => {
    const eliminated = vi.fn(); engine.cb.onEliminated = eliminated;
    engine.startArena(10); engine.bodies = [];
    for (const b of engine.bots) { b.x = engine.worldR * 0.7; b.y = b.id * 100; }
    const killer = engine.bots[0]; killer.x = killer.y = 0; killer.mass = killer.disp = 100;
    tick(engine, 0.7);
    expect(engine.playerAlive).toBe(false); expect(engine.paused).toBe(true);
    expect(eliminated).toHaveBeenCalledWith(killer.name); expect(eliminated).toHaveBeenCalledTimes(1);
  });
  it("returns to unchanged endless gameplay", () => {
    engine.startArena(25); engine.startRun(200);
    expect(engine.arena).toBe(false); expect(engine.bots).toHaveLength(0);
    expect(engine.player.mass).toBe(200); expect(engine.bodies).toHaveLength(PLAYER.density);
  });
  it("a bot pulls nearby eligible food and gains its configured mass", () => {
    engine.startArena(10);
    for (const b of engine.bots) { b.x = engine.worldR * 0.8; b.y = b.id * 100; }
    const bot = engine.bots[0]; bot.x = bot.y = 0; bot.mass = bot.disp = 10;
    bot.tx = bot.ty = 0; bot.thinkT = 10;
    engine.player.x = -engine.worldR * 0.8;
    const body = engine.bodies[0]; body.x = body.y = 0; body.kind = kindAt(0); body.mass = 1;
    engine.bodies = [body]; tick(engine, 0.25);
    expect(body.dead).toBe(true); expect(bot.mass).toBe(11);
  });
  it("player absorption adds the victim mass and leaderboard rank updates", () => {
    const onArena = vi.fn(); engine.cb.onArena = onArena; engine.startArena(10);
    engine.bodies = [];
    for (const b of engine.bots) { b.x = engine.worldR * 0.8; b.y = b.id * 100; b.mass = b.disp = 10; }
    engine.player.mass = engine.player.disp = 100;
    const victim = engine.bots[0]; victim.x = victim.y = 0;
    tick(engine, 0.9);
    expect(victim.alive).toBe(false); expect(engine.player.mass).toBeCloseTo(104.5, 5);
    expect(onArena.mock.lastCall?.[0].rank).toBe(1);
  });
});
describe("core strike", () => {
  const duel = (playerMass: number, rivalMass: number, gap: number) => {
    engine.startArena(10); engine.bodies = [];
    for (const b of engine.bots) { b.x = engine.worldR * 0.8; b.y = b.id * 100; b.mass = b.disp = 10; }
    const P = engine.player; P.mass = P.disp = playerMass; P.vx = P.vy = 0;
    const rival = engine.bots[0]; rival.mass = rival.disp = rivalMass;
    rival.x = P.x + radiusForMass(rivalMass) + gap; rival.y = P.y; rival.thinkT = 99; rival.tx = rival.x; rival.ty = rival.y;
    return rival;
  };
  it.each([[40, 40], [40, 200], [40, 800]])("a %s-mass player core-strikes a %s-mass rival", (pm, rm) => {
    const rival = duel(pm, rm, 20);
    engine.strike(); tick(engine, 1.2);
    expect(rival.alive).toBe(false); expect(engine.playerAlive).toBe(true);
    tick(engine, 1);
    expect(engine.player.mass).toBeGreaterThan(pm + rm * 0.45);
  });
  it("two large holes: a strike still beats an equal giant", () => {
    const rival = duel(1e6, 1e6, -radiusForMass(1e6) * 0.5 + 20);
    engine.strike(); tick(engine, 1.2);
    expect(rival.alive).toBe(false); expect(engine.playerAlive).toBe(true);
  });
  it("a large rival reads a telegraphed strike and sidesteps", () => {
    const s = newStrike(); tryStrike(s, 1, 0);
    const dodge = dodgeTarget(100, 0, 40, 0, 0, s, () => 0.9);
    expect(dodge).not.toBeNull(); expect(Math.abs(dodge!.y)).toBeGreaterThan(200);
    expect(dodgeTarget(100, 0, 40, 0, 0, newStrike(), () => 0.9)).toBeNull();
  });
  it("a missed strike leaves the player vulnerable to a slightly bigger rival", () => {
    engine.startArena(10); engine.bodies = [];
    for (const b of engine.bots) { b.x = engine.worldR * 0.8; b.y = b.id * 100; }
    engine.strike(); tick(engine, 0.9);
    expect(engine.pStrike.vuln).toBeGreaterThan(0);
    const r = engine.bots[0]; r.mass = r.disp = engine.player.mass * 1.1; r.x = engine.player.x; r.y = engine.player.y; r.thinkT = 99;
    tick(engine, 0.8);
    expect(engine.playerAlive).toBe(false);
  });
});
describe("constant speed", () => {
  it.each([10, 1e3, 1e6, 1e9])("player top speed is identical at %s mass", (mass) => {
    engine.startArena(10); engine.player.mass = engine.player.disp = mass;
    (engine as unknown as { keys: Set<string> }).keys.add("d"); engine.bots = []; engine.bodies = [];
    tick(engine, 4);
    expect(Math.hypot(engine.player.vx, engine.player.vy)).toBeCloseTo(95, 0);
  });
});

describe("endgame size", () => {
  it("keeps the largest holes at 5–8% of the arena diameter while mass keeps growing", () => {
    for (const m of [1e6, 1e9, 1e15, 1e100]) {
      const share = radiusForMass(m) * 2 / (ARENA.worldRadius * 2);
      expect(share).toBeGreaterThan(0.05); expect(share).toBeLessThan(0.08);
    }
    expect(radiusForMass(1e12)).toBeLessThanOrEqual(MAX_RADIUS * 1.08);
    expect(addMass(1e12, 5e11)).toBe(1.5e12);
  });
  it("runs smoothly with every opponent active at endgame mass", () => {
    engine.startArena(100); engine.player.mass = engine.player.disp = 1e8;
    for (const b of engine.bots) b.mass = b.disp = 1e4 + b.id * 1e5;
    const t0 = performance.now(); tick(engine, 3);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(engine.bots.length).toBeGreaterThanOrEqual(100);
    expect(engine.bots.every((b) => Number.isFinite(b.x) && Number.isFinite(b.mass))).toBe(true);
  });
});
