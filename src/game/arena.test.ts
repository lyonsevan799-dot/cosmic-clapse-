import { describe, expect, it } from "vitest";
import {
  ARENA, PERSONALITY_LIST, STRIKE, botStartMass, canEat, computeLeaderboard, decide, eliminationReward,
  makeBotName, newStrike, pickPersonality, spawnPosAwayFrom, strikeConnected, strikeHits, tickStrike,
  tryStrike, SpatialGrid, type Bot,
} from "./arena";
import { SKINS } from "./data";

const seeded = (seed: number) => {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

const testBot = (over: Partial<Bot> = {}): Bot => ({
  id: 0, name: "TestBot", skin: SKINS[0], x: 0, y: 0, vx: 0, vy: 0, mass: 100, disp: 100,
  personality: "balanced", speed: 1, thinkT: 0, mode: "wander", tx: 0, ty: 0, foodRef: null,
  alive: true, respawnT: 0, dying: false, dieT: 0, dieDur: 0.6, eater: null, wob: 0,
  strike: newStrike(), ...over,
});

describe("arena rules", () => {
  it("generates unique bot names", () => {
    const used = new Set<string>();
    const names = new Set<string>();
    for (let i = 0; i < 150; i++) names.add(makeBotName(seeded(i + 1), used));
    expect(names.size).toBe(150);
  });
  it("a hole can only eat a clearly smaller hole", () => {
    expect(canEat(140, 100)).toBe(true);
    expect(canEat(139, 100)).toBe(false);
    expect(canEat(100, 100)).toBe(false);
    expect(canEat(10, 400)).toBe(false);
  });
  it("bot starting mass stays within limits", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const m = botStartMass(() => r, 10);
      expect(m).toBeGreaterThanOrEqual(6);
      expect(m).toBeLessThanOrEqual(400);
    }
  });
  it("bots never spawn beside the player", () => {
    const rand = seeded(7);
    for (let i = 0; i < 50; i++) {
      const p = spawnPosAwayFrom(rand, 0, 0, 800, 1000);
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(799);
    }
  });
  it("fallback spawns stay inside the world near its edge", () => {
    const pos = spawnPosAwayFrom(() => 0, 950, 0, 900, 1000);
    expect(Math.hypot(pos.x, pos.y)).toBeLessThanOrEqual(1000);
    expect(Math.hypot(pos.x - 950, pos.y)).toBeGreaterThanOrEqual(900);
    expect(spawnPosAwayFrom(() => 0, 0, 0, 1100, 1000)).toEqual({ x: -1000, y: 0 });
  });
  it("insets respawns for opponent radius and safety margin at the player boundary", () => {
    const pos = spawnPosAwayFrom(() => 0, 1000, 0, 1e9, 1000, 40, 24);
    expect(pos).toEqual({ x: -936, y: 0 });
    expect(Math.hypot(pos.x, pos.y) + 40 + 24).toBeLessThanOrEqual(1000);
  });
  it("returns finite valid spawns for degenerate geometry and invalid input", () => {
    expect(spawnPosAwayFrom(() => NaN, NaN, Infinity, Infinity, 1000, 2000)).toEqual({ x: 0, y: 0 });
  });
  it("leaderboard is sorted, top 10, with accurate player rank", () => {
    const bots = Array.from({ length: 12 }, (_, i) => ({ name: `B${i}`, mass: (i + 1) * 100, alive: true }));
    const lb = computeLeaderboard(bots, 50, true);
    expect(lb.leaders).toHaveLength(10);
    expect(lb.leaders[0].mass).toBe(1200);
    expect(lb.rank).toBe(13);
    const top = computeLeaderboard(bots, 2000, true);
    expect(top.rank).toBe(1);
    expect(top.leaders[0].isPlayer).toBe(true);
    const dead = computeLeaderboard(bots, 50, false);
    expect(dead.rank).toBe(13);
  });
  it("sneaky bots flee from bigger holes, away from the threat", () => {
    const bot = testBot({ personality: "sneaky", x: 0, y: 0 });
    decide(bot, { threat: { x: 100, y: 0 }, prey: null, food: null }, () => 0.5, ARENA.worldRadius);
    expect(bot.mode).toBe("flee");
    expect(bot.tx).toBeLessThan(0); // runs away from the threat at +x
  });
  it("aggressive bots hunt smaller holes", () => {
    const bot = testBot({ personality: "aggressive", x: 0, y: 0 });
    decide(bot, { threat: null, prey: { x: 500, y: 300 }, food: null }, () => 0.5, ARENA.worldRadius);
    expect(bot.mode).toBe("hunt");
    expect(bot.tx).toBe(500);
  });
  it("collectors go for food when nothing threatens them", () => {
    const bot = testBot({ personality: "collector", x: 0, y: 0 });
    decide(bot, { threat: null, prey: null, food: { x: -200, y: 100 } }, () => 0.5, ARENA.worldRadius);
    expect(bot.mode).toBe("food");
    expect(bot.tx).toBe(-200);
  });
  it("bots wander when there is nothing to do", () => {
    const bot = testBot({ mode: "food", tx: 0, ty: 0 });
    decide(bot, { threat: null, prey: null, food: null }, seeded(3), ARENA.worldRadius);
    expect(bot.mode).toBe("wander");
    expect(Math.hypot(bot.tx, bot.ty)).toBeGreaterThan(0);
  });
  it("personalities and spatial grid behave", () => {
    const rand = seeded(11);
    for (let i = 0; i < 30; i++) expect(PERSONALITY_LIST).toContain(pickPersonality(rand));
    const grid = new SpatialGrid<{ x: number; y: number; id: number }>(100);
    grid.insert({ x: 10, y: 10, id: 1 });
    grid.insert({ x: 5000, y: 5000, id: 2 });
    const out: { id: number }[] = [];
    grid.query(0, 0, 150, out as { x: number; y: number; id: number }[]);
    expect(out.map((o) => o.id)).toEqual([1]);
  });
  it("queries enormous sense radii through occupied cells, not empty space", () => {
    const grid = new SpatialGrid<{ x: number; y: number }>(240);
    grid.insert({ x: 0, y: 0 }); grid.insert({ x: 1000, y: -1000 });
    const out: { x: number; y: number }[] = [];
    grid.query(0, 0, 1e100, out);
    expect(out).toHaveLength(2);
  });
});
