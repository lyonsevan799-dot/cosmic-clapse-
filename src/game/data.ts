// Single source of truth for all tunable game data (endless mode).

export type Style =
  | "dust" | "asteroid" | "moon" | "rocky" | "terran" | "gas" | "star" | "neutron"
  | "blackhole" | "system" | "nebula" | "galaxy" | "cluster" | "relic";

export type Category = "planet" | "star" | "galaxy" | null;

export interface Kind {
  idx: number;
  name: string;
  plural: string;
  style: Style;
  /** Average mass gained when absorbed. */
  mass: number;
  /** Player mass required before this object can be absorbed. */
  minMass: number;
  /** Visual size multiplier on top of the mass-derived radius. */
  size: number;
  absorbTime: number;
  pull: number;
  tier: 0 | 1 | 2 | 3; // feedback tier: 0 small, 1 planet, 2 star, 3 cosmic
  category: Category;
  hue: number;
}

type Base = Omit<Kind, "idx" | "hue"> & { hue?: number };
const CATALOG: Base[] = [
  { name: "Space Debris", plural: "Space debris", style: "dust", mass: 1, minMass: 0, size: 0.7, absorbTime: 0.18, pull: 1.3, tier: 0, category: null },
  { name: "Small Asteroid", plural: "Small asteroids", style: "asteroid", mass: 2, minMass: 14, size: 1, absorbTime: 0.28, pull: 1.15, tier: 0, category: null },
  { name: "Large Asteroid", plural: "Large asteroids", style: "asteroid", mass: 5, minMass: 32, size: 1, absorbTime: 0.38, pull: 1.05, tier: 0, category: null },
  { name: "Small Moon", plural: "Small moons", style: "moon", mass: 12, minMass: 70, size: 1, absorbTime: 0.5, pull: 1, tier: 1, category: null },
  { name: "Small Planet", plural: "Small planets", style: "rocky", mass: 25, minMass: 140, size: 1, absorbTime: 0.6, pull: 0.95, tier: 1, category: "planet" },
  { name: "Moon", plural: "Moons", style: "moon", mass: 50, minMass: 280, size: 1, absorbTime: 0.7, pull: 0.92, tier: 1, category: null },
  { name: "Large Planet", plural: "Large planets", style: "terran", mass: 100, minMass: 550, size: 1, absorbTime: 0.85, pull: 0.9, tier: 1, category: "planet" },
  { name: "Gas Giant", plural: "Gas giants", style: "gas", mass: 300, minMass: 1500, size: 1.1, absorbTime: 1, pull: 0.85, tier: 1, category: "planet" },
  { name: "Star", plural: "Stars", style: "star", mass: 1000, minMass: 5000, size: 1, absorbTime: 1.2, pull: 0.8, tier: 2, category: "star" },
  { name: "Giant Star", plural: "Giant stars", style: "star", mass: 3000, minMass: 15000, size: 1.15, absorbTime: 1.3, pull: 0.78, tier: 2, category: "star" },
  { name: "Neutron Star", plural: "Neutron stars", style: "neutron", mass: 8000, minMass: 40000, size: 0.6, absorbTime: 1.2, pull: 0.78, tier: 2, category: "star" },
  { name: "Rogue Black Hole", plural: "Black holes", style: "blackhole", mass: 25000, minMass: 120000, size: 0.8, absorbTime: 1.3, pull: 0.75, tier: 2, category: null },
  { name: "Solar System", plural: "Solar systems", style: "system", mass: 100000, minMass: 500000, size: 1.3, absorbTime: 1.4, pull: 0.72, tier: 3, category: null },
  { name: "Nebula", plural: "Nebulae", style: "nebula", mass: 400000, minMass: 2e6, size: 1.4, absorbTime: 1.4, pull: 0.7, tier: 3, category: null },
  { name: "Dwarf Galaxy", plural: "Dwarf galaxies", style: "galaxy", mass: 2e6, minMass: 1e7, size: 1.2, absorbTime: 1.5, pull: 0.7, tier: 3, category: "galaxy" },
  { name: "Galaxy", plural: "Galaxies", style: "galaxy", mass: 1e7, minMass: 5e7, size: 1.35, absorbTime: 1.5, pull: 0.7, tier: 3, category: "galaxy", hue: 40 },
  { name: "Galaxy Cluster", plural: "Galaxy clusters", style: "cluster", mass: 1e8, minMass: 5e8, size: 1.3, absorbTime: 1.6, pull: 0.68, tier: 3, category: "galaxy" },
];

const BEYOND: { name: string; plural: string; style: Style }[] = [
  { name: "Supercluster", plural: "Superclusters", style: "cluster" },
  { name: "Cosmic Filament", plural: "Cosmic filaments", style: "nebula" },
  { name: "Great Wall", plural: "Great walls", style: "galaxy" },
  { name: "Void Bubble", plural: "Void bubbles", style: "relic" },
  { name: "Hubble Sphere", plural: "Hubble spheres", style: "nebula" },
  { name: "Pocket Universe", plural: "Pocket universes", style: "galaxy" },
  { name: "Multiverse Shard", plural: "Multiverse shards", style: "relic" },
  { name: "Brane Fragment", plural: "Brane fragments", style: "cluster" },
  { name: "Omniversal Seed", plural: "Omniversal seeds", style: "relic" },
];

const ROMAN = ["", " II", " III", " IV", " V", " VI", " VII", " VIII", " IX", " X"];
const kindCache = new Map<number, Kind>();

/** Object kinds are infinite: a hand-made catalog followed by procedural cosmic tiers. */
export function kindAt(idx: number): Kind {
  const hit = kindCache.get(idx); if (hit) return hit;
  let k: Kind;
  if (idx < CATALOG.length) {
    const b = CATALOG[idx];
    k = { ...b, idx, hue: b.hue ?? (idx * 47) % 360 };
  } else {
    const n = idx - CATALOG.length; // 0,1,2...
    const b = BEYOND[n % BEYOND.length];
    const cycle = Math.floor(n / BEYOND.length);
    const suffix = cycle < ROMAN.length ? ROMAN[cycle] : ` ${cycle + 1}`;
    const mass = Math.min(1e295, 1e9 * Math.pow(10, n));
    k = {
      idx, name: b.name + suffix, plural: b.plural + suffix, style: b.style,
      mass, minMass: mass * 5, size: 1.3, absorbTime: 1.6, pull: 0.68, tier: 3, category: "galaxy",
      hue: (n * 67 + 200) % 360,
    };
  }
  kindCache.set(idx, k);
  return k;
}
export const CATALOG_SIZE = CATALOG.length;

/** Highest kind index the player can currently absorb. */
export function topEligibleIndex(mass: number): number {
  let i = 0;
  while (kindAt(i + 1).minMass <= mass && i < 400) i++;
  return i;
}

export interface Achievement { id: string; name: string; icon: string; desc: string; mass: number; }
export const ACHIEVEMENTS: Achievement[] = [
  { id: "first", name: "First Bite", icon: "✦", desc: "Absorb your first object", mass: 0 },
  { id: "m1e2", name: "Hungry Hole", icon: "☄", desc: "Reach 100 mass", mass: 1e2 },
  { id: "m1e3", name: "Planet Eater", icon: "◍", desc: "Reach 1,000 mass", mass: 1e3 },
  { id: "m1e4", name: "World Devourer", icon: "🪐", desc: "Reach 10,000 mass", mass: 1e4 },
  { id: "m1e5", name: "Star Crusher", icon: "✸", desc: "Reach 100,000 mass", mass: 1e5 },
  { id: "m1e6", name: "Solar System Eater", icon: "☉", desc: "Reach 1 million mass", mass: 1e6 },
  { id: "m1e7", name: "Nebula Drinker", icon: "☁", desc: "Reach 10 million mass", mass: 1e7 },
  { id: "m1e8", name: "Galactic Threat", icon: "✺", desc: "Reach 100 million mass", mass: 1e8 },
  { id: "m1e9", name: "Galaxy Devourer", icon: "🌌", desc: "Reach 1 billion mass", mass: 1e9 },
  { id: "m1e12", name: "Universal Menace", icon: "⚛", desc: "Reach 1 trillion mass", mass: 1e12 },
  { id: "m1e15", name: "Cosmic Legend", icon: "♛", desc: "Reach 1 quadrillion mass", mass: 1e15 },
  { id: "m1e18", name: "Beyond Infinity", icon: "∞", desc: "Reach 1 quintillion mass", mass: 1e18 },
  { id: "m1e24", name: "Reality Breaker", icon: "✧", desc: "Reach 1 septillion mass", mass: 1e24 },
  { id: "m1e30", name: "Omniversal Hunger", icon: "◉", desc: "Reach 1 nonillion mass", mass: 1e30 },
];

export interface Skin {
  id: string;
  name: string;
  hot: string;
  mid: string;
  outer: string;
  glow: string;
  /** Achievement that unlocks it; null = always owned. */
  achievement: string | null;
  animated?: boolean;
}
export const SKINS: Skin[] = [
  { id: "horizon", name: "Event Horizon", hot: "#e6fbff", mid: "#38d9f5", outer: "#9b5cff", glow: "#4fb8ff", achievement: null },
  { id: "violet", name: "Violet Nebula", hot: "#f3e6ff", mid: "#a86bff", outer: "#4b3bd6", glow: "#8a5cff", achievement: "m1e3" },
  { id: "solar", name: "Solar Flare", hot: "#fff6d6", mid: "#ffc341", outer: "#ff6a1f", glow: "#ff9a3c", achievement: "m1e4" },
  { id: "emerald", name: "Emerald Void", hot: "#e8fff4", mid: "#34e89e", outer: "#1fb8c9", glow: "#2fd6a8", achievement: "m1e5" },
  { id: "rose", name: "Rose Quasar", hot: "#fff0f7", mid: "#ff6fb5", outer: "#b38cff", glow: "#ff8ccf", achievement: "m1e6" },
  { id: "frozen", name: "Frozen Singularity", hot: "#ffffff", mid: "#bfeaff", outer: "#6fb6ff", glow: "#d6f2ff", achievement: "m1e7" },
  { id: "crimson", name: "Crimson Collapse", hot: "#ffe6e6", mid: "#ff3b5c", outer: "#7a2cff", glow: "#ff3b6b", achievement: "m1e8" },
  { id: "crown", name: "Galactic Crown", hot: "#ffffff", mid: "#ff6fb5", outer: "#38d9f5", glow: "#ffd36b", achievement: "m1e9", animated: true },
];

export const PLAYER = {
  startMass: 10,
  speedPerRadius: 15,
  accel: 8,
  decel: 5,
  gravityMult: 3.1,
  density: 110,
};
