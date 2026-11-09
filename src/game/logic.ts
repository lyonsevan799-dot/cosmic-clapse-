// Pure game rules: save validation, eligibility, achievements, number formatting. No DOM here.
import { ACHIEVEMENTS, PLAYER, SKINS, kindAt, type Kind } from "./data";

export const SAVE_VERSION = 3;
export const SAVE_KEY = "cosmic-collapse-save";
export const MAX_MASS = 1e300;

export interface Settings { audio: boolean; sfx: number; music: number; shake: boolean; reduced: boolean; botCount: number; }
export interface LifetimeStats { absorbed: number; planets: number; stars: number; galaxies: number; playTime: number; opponents: number; bestSurvival: number; bestRank: number; }
export interface SaveData {
  version: number;
  bestMass: number;
  /** Mass of the run in progress, for Continue. 0 = no run. */
  runMass: number;
  achievements: string[];
  stats: LifetimeStats;
  skin: string;
  settings: Settings;
  tutorialDone: boolean;
  playerName: string;
}

export const defaultSave = (): SaveData => ({
  version: SAVE_VERSION,
  bestMass: 0,
  runMass: 0,
  achievements: [],
  stats: { absorbed: 0, planets: 0, stars: 0, galaxies: 0, playTime: 0, opponents: 0, bestSurvival: 0, bestRank: 101 },
  playerName: "Drifter",
  skin: "horizon",
  settings: { audio: true, sfx: 0.7, music: 0.4, shake: true, reduced: false, botCount: 100 },
  tutorialDone: false,
});

const num = (v: unknown, d: number, min = -Infinity, max = Infinity) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** Validate a parsed save field-by-field, keeping every valid field. Migrates v1 saves. */
export function validateSave(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, any>;
  const st = r.stats && typeof r.stats === "object" ? r.stats : {};
  const s = r.settings && typeof r.settings === "object" ? r.settings : {};
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  const achievements = Array.isArray(r.achievements) ? [...new Set(r.achievements.filter((x: unknown) => typeof x === "string" && ids.has(x)))] as string[] : [];
  const out: SaveData = {
    version: SAVE_VERSION,
    bestMass: num(r.bestMass, 0, 0, MAX_MASS),
    runMass: num(r.runMass, 0, 0, MAX_MASS),
    achievements,
    stats: {
      absorbed: Math.floor(num(st.absorbed, 0, 0, 1e15)),
      planets: Math.floor(num(st.planets, 0, 0, 1e15)),
      stars: Math.floor(num(st.stars, 0, 0, 1e15)),
      galaxies: Math.floor(num(st.galaxies, 0, 0, 1e15)),
      playTime: num(st.playTime, 0, 0, 1e12),
      opponents: Math.floor(num(st.opponents, 0, 0, 1e15)),
      bestSurvival: num(st.bestSurvival, 0, 0, 1e12),
      bestRank: Math.floor(num(st.bestRank, 101, 1, 151)),
    },
    skin: "horizon",
    settings: {
      audio: bool(s.audio, d.settings.audio),
      sfx: num(s.sfx, d.settings.sfx, 0, 1),
      music: num(s.music, d.settings.music, 0, 1),
      shake: bool(s.shake, d.settings.shake),
      reduced: bool(s.reduced, d.settings.reduced),
      botCount: Math.round(num(s.botCount, d.settings.botCount, 10, 150)),
    },
    tutorialDone: bool(r.tutorialDone, false),
    playerName: normalizeName(r.playerName),
  };
  // keep any achievements implied by best mass (e.g. after a partial save)
  const fixed = unlockAchievements(out, out.bestMass);
  if (typeof r.skin === "string" && skinOwned(fixed.save, r.skin)) fixed.save.skin = r.skin;
  return fixed.save;
}

export function normalizeName(value: unknown) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 18) || "Drifter" : "Drifter";
}

export function skinOwned(save: Pick<SaveData, "achievements">, id: string) {
  const sk = SKINS.find((s) => s.id === id);
  return !!sk && (sk.achievement === null || save.achievements.includes(sk.achievement));
}

/** Visual radius cap: the largest holes span ~7% of the arena diameter, never the map. */
export const MAX_RADIUS = 230;
export function radiusForMass(m: number) {
  const raw = 4 * Math.cbrt(Math.max(1, Math.min(MAX_MASS, m)));
  if (raw <= MAX_RADIUS) return raw;
  // Mass keeps growing forever, but radius creeps toward 1.08× the cap (diminishing returns).
  return MAX_RADIUS * (1.08 - 0.08 * Math.exp(-Math.log10(raw / MAX_RADIUS)));
}
export function canAbsorb(playerMass: number, kind: Kind | number) {
  const k = typeof kind === "number" ? kindAt(kind) : kind;
  return playerMass >= k.minMass;
}

/** Add mass safely: never decreases, never becomes Infinity/NaN. */
export function addMass(mass: number, gain: number) {
  if (!Number.isFinite(gain) || gain <= 0) return mass;
  const n = mass + gain;
  return Number.isFinite(n) ? Math.min(MAX_MASS, n) : MAX_MASS;
}

/** Apply one absorption to lifetime stats. */
export function recordAbsorb(stats: LifetimeStats, kind: Kind): LifetimeStats {
  return {
    ...stats,
    absorbed: stats.absorbed + 1,
    planets: stats.planets + (kind.category === "planet" ? 1 : 0),
    stars: stats.stars + (kind.category === "star" ? 1 : 0),
    galaxies: stats.galaxies + (kind.category === "galaxy" ? 1 : 0),
  };
}

/** Unlock all achievements met by `mass` (and First Bite once anything is absorbed). Each unlocks only once. */
export function unlockAchievements(save: SaveData, mass: number) {
  const best = Math.max(save.bestMass, Math.min(MAX_MASS, Number.isFinite(mass) ? mass : MAX_MASS));
  const got = new Set(save.achievements);
  const unlocked = ACHIEVEMENTS.filter((a) => {
    if (got.has(a.id)) return false;
    return a.id === "first" ? save.stats.absorbed > 0 : best >= a.mass;
  });
  if (!unlocked.length && best === save.bestMass) return { save, unlocked };
  return { save: { ...save, bestMass: best, achievements: [...save.achievements, ...unlocked.map((a) => a.id)] }, unlocked };
}

/** Next locked mass achievement, with log-scale progress from the previous one. */
export function nextAchievement(save: SaveData, mass: number) {
  const list = ACHIEVEMENTS.filter((a) => a.id !== "first");
  const idx = list.findIndex((a) => !save.achievements.includes(a.id) && a.mass > Math.max(save.bestMass, mass));
  if (idx < 0) return null;
  const a = list[idx];
  const prev = idx > 0 ? list[idx - 1].mass : 1;
  const lp = Math.log10(Math.max(1, prev)), ln = Math.log10(a.mass), lm = Math.log10(Math.max(1, mass));
  return { achievement: a, progress: Math.min(1, Math.max(0, (lm - lp) / (ln - lp))) };
}

const SUFFIX = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc", "UDc", "DDc", "TDc", "QaDc", "QiDc", "SxDc", "SpDc", "OcDc", "NoDc", "Vg"];
/** 950 → "950", 1234 → "1.23K", 3.5e6 → "3.50M"; huge values fall back to scientific notation. */
export function formatMass(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "1.00e300" : "0";
  if (n < 1000) return String(Math.floor(Math.max(0, n)));
  const e = Math.floor(Math.log10(n) / 3);
  if (e >= SUFFIX.length) {
    const [m, x] = n.toExponential(2).split("e");
    return `${m}e${x.replace("+", "")}`;
  }
  const v = n / Math.pow(1000, e);
  const fixed = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  // rounding like 999.96K → "1000K": bump to next suffix
  if (Number(fixed) >= 1000 && e + 1 < SUFFIX.length) return `1.00${SUFFIX[e + 1]}`;
  return fixed + SUFFIX[e];
}

export const startMass = () => PLAYER.startMass;

// ---------- storage ----------
let memoryStore: string | null = null;
export let storageAvailable = true;
export function loadSave(): SaveData {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return validateSave(raw ? JSON.parse(raw) : null);
  } catch {
    storageAvailable = false;
    try { return validateSave(memoryStore ? JSON.parse(memoryStore) : null); } catch { return defaultSave(); }
  }
}
export function writeSave(save: SaveData) {
  const s = JSON.stringify(save);
  memoryStore = s;
  try { window.localStorage.setItem(SAVE_KEY, s); } catch { storageAvailable = false; }
}
