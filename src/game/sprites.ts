// Procedural, cached object artwork drawn into offscreen canvases.
import type { Kind, Style } from "./data";

export interface Sprite { c: HTMLCanvasElement; pad: number; R: number; tint: string; }

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, Sprite>();
export const VARIANTS = 6;
const R0 = 48;
const PAD: Partial<Record<Style, number>> = { gas: 2.4, star: 2.4, neutron: 3, relic: 2.1, rocky: 1.35, terran: 1.35, moon: 1.1, blackhole: 2.6, system: 1.1, nebula: 1.25, galaxy: 1.15, cluster: 1.15 };

export function getSprite(kind: Kind, variant: number): Sprite | null {
  if (kind.style === "dust") return null;
  const key = `${kind.style}:${kind.hue}:${variant}`;
  const hit = cache.get(key); if (hit) return hit;
  const R = R0;
  const pad = PAD[kind.style] ?? 1.15;
  const size = Math.ceil(R * 2 * pad);
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.translate(size / 2, size / 2);
  const r = rng(variant * 9973 + kind.style.length * 131 + kind.hue * 7 + 7);
  let tint = "#ffffff";
  switch (kind.style) {
    case "asteroid": tint = asteroid(ctx, R, r); break;
    case "moon": tint = moon(ctx, R, r); break;
    case "rocky": case "terran": tint = planet(ctx, R, r, kind.style === "terran"); break;
    case "gas": tint = gas(ctx, R, r); break;
    case "star": tint = star(ctx, R, r); break;
    case "neutron": tint = neutron(ctx, R); break;
    case "relic": tint = relic(ctx, R, r, variant + kind.idx); break;
    case "blackhole": tint = rogueHole(ctx, R, r); break;
    case "system": tint = system(ctx, R, r); break;
    case "nebula": tint = nebula(ctx, R, r, kind.hue); break;
    case "galaxy": tint = galaxy(ctx, R, r, kind.hue); break;
    case "cluster": tint = cluster(ctx, R, r, kind.hue); break;
    default: break;
  }
  const s = { c, pad, R, tint };
  cache.set(key, s);
  return s;
}

function rogueHole(ctx: CanvasRenderingContext2D, R: number, r: () => number) {
  const hue = pick(r, [25, 35, 200, 280]);
  const g = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 2.5);
  g.addColorStop(0, `hsla(${hue},95%,60%,0.55)`); g.addColorStop(1, `hsla(${hue},95%,50%,0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.rotate(-0.3); ctx.scale(1, 0.3);
  for (let i = 0; i < 4; i++) { ctx.strokeStyle = `hsla(${hue + i * 8},95%,${75 - i * 10}%,${0.8 - i * 0.15})`; ctx.lineWidth = R * 0.18; ctx.beginPath(); ctx.arc(0, 0, R * (1.3 + i * 0.25), 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `hsla(${hue},100%,85%,0.9)`; ctx.lineWidth = R * 0.06; ctx.beginPath(); ctx.arc(0, 0, R * 0.92, 0, Math.PI * 2); ctx.stroke();
  return `hsl(${hue},95%,65%)`;
}

function system(ctx: CanvasRenderingContext2D, R: number, r: () => number) {
  const sc = pick(r, ["#ffd36b", "#a8d6ff", "#ff9a6b"]);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.35);
  g.addColorStop(0, "#fff"); g.addColorStop(0.4, sc); g.addColorStop(1, sc + "00");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 0.35, 0, Math.PI * 2); ctx.fill();
  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const d = R * (0.3 + (i + 1) * (0.68 / n));
    ctx.strokeStyle = "rgba(180,200,255,0.22)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, d, 0, Math.PI * 2); ctx.stroke();
    const a = r() * Math.PI * 2, pr = R * (0.03 + r() * 0.05);
    ctx.fillStyle = `hsl(${Math.floor(r() * 360)},70%,65%)`; ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, pr, 0, Math.PI * 2); ctx.fill();
  }
  return sc;
}

function nebula(ctx: CanvasRenderingContext2D, R: number, r: () => number, hue: number) {
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = R * r() * 0.65, br = R * (0.25 + r() * 0.4);
    const h = hue + (r() - 0.5) * 80;
    const g = ctx.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, br);
    g.addColorStop(0, `hsla(${h},90%,65%,0.22)`); g.addColorStop(1, `hsla(${h},90%,50%,0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, br, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 30; i++) { ctx.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.6})`; ctx.beginPath(); ctx.arc((r() - 0.5) * R * 1.6, (r() - 0.5) * R * 1.6, 0.6 + r() * 1.2, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalCompositeOperation = "source-over";
  return `hsl(${hue},90%,70%)`;
}

function galaxy(ctx: CanvasRenderingContext2D, R: number, r: () => number, hue: number) {
  ctx.globalCompositeOperation = "lighter";
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.45);
  core.addColorStop(0, "rgba(255,245,220,0.95)"); core.addColorStop(1, `hsla(${hue},80%,60%,0)`);
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, R * 0.45, 0, Math.PI * 2); ctx.fill();
  const arms = 2 + Math.floor(r() * 3);
  for (let i = 0; i < 420; i++) {
    const t = r(); const arm = i % arms;
    const ang = t * 4.2 + (arm / arms) * Math.PI * 2 + (r() - 0.5) * 0.5;
    const d = R * (0.08 + t * 0.9);
    const h = hue + (r() < 0.3 ? 180 : 0) + (r() - 0.5) * 30;
    ctx.fillStyle = `hsla(${h},85%,${65 + r() * 25}%,${0.25 + (1 - t) * 0.5})`;
    ctx.beginPath(); ctx.arc(Math.cos(ang) * d, Math.sin(ang) * d, 0.5 + r() * 1.6 * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  return `hsl(${hue},85%,72%)`;
}

function cluster(ctx: CanvasRenderingContext2D, R: number, r: () => number, hue: number) {
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  halo.addColorStop(0, `hsla(${hue},70%,60%,0.25)`); halo.addColorStop(1, `hsla(${hue},70%,50%,0)`);
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2, d = R * Math.sqrt(r()) * 0.85, gr = R * (0.04 + r() * 0.1);
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    ctx.save(); ctx.translate(x, y); ctx.rotate(r() * 3); ctx.scale(1, 0.4 + r() * 0.5);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
    g.addColorStop(0, "rgba(255,250,235,0.95)"); g.addColorStop(1, `hsla(${hue + (r() - 0.5) * 90},80%,65%,0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, gr, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.globalCompositeOperation = "source-over";
  return `hsl(${hue},80%,72%)`;
}

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

function shade(ctx: CanvasRenderingContext2D, R: number, strength = 0.8) {
  const g = ctx.createRadialGradient(-R * 0.45, -R * 0.45, R * 0.1, -R * 0.2, -R * 0.2, R * 1.6);
  g.addColorStop(0, "rgba(255,255,255,0.18)");
  g.addColorStop(0.45, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(2,0,12,${strength})`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
}

function asteroid(ctx: CanvasRenderingContext2D, R: number, r: () => number) {
  const col = pick(r, [["#a3a8b8", "#4a4f63"], ["#8f9bb8", "#3b4560"], ["#9d8fb3", "#43395c"], ["#b0a99f", "#4d4741"]]);
  const n = 9 + Math.floor(r() * 4);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const d = R * (0.68 + r() * 0.32); pts.push([Math.cos(a) * d, Math.sin(a) * d]); }
  const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  const g = ctx.createLinearGradient(-R, -R, R, R); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
  path(); ctx.fillStyle = g; ctx.fill();
  ctx.save(); path(); ctx.clip();
  for (let i = 0; i < n; i += 2) { // facets
    const a = pts[i], b = pts[(i + 1) % n];
    ctx.beginPath(); ctx.moveTo(R * (r() - 0.5) * 0.4, R * (r() - 0.5) * 0.4); ctx.lineTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.closePath();
    ctx.fillStyle = `rgba(${r() > 0.5 ? "255,255,255" : "0,0,0"},${0.06 + r() * 0.1})`; ctx.fill();
  }
  for (let i = 0; i < 3 + r() * 3; i++) {
    const x = (r() - 0.5) * R * 1.1, y = (r() - 0.5) * R * 1.1, cr = R * (0.08 + r() * 0.16);
    ctx.fillStyle = "rgba(10,8,25,0.35)"; ctx.beginPath(); ctx.arc(x, y, cr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = Math.max(0.6, cr * 0.25); ctx.beginPath(); ctx.arc(x, y, cr, 0.2, 1.8); ctx.stroke();
  }
  ctx.restore();
  path(); ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1; ctx.stroke();
  return col[0];
}

function moon(ctx: CanvasRenderingContext2D, R: number, r: () => number) {
  const col = pick(r, [["#e3e6ee", "#8d93a6"], ["#d4e6fa", "#7c98bf"], ["#ddd3f0", "#8a7fae"], ["#cfcfd4", "#6d6f7a"]]);
  const g = ctx.createRadialGradient(-R * 0.3, -R * 0.3, 0, 0, 0, R); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  for (let i = 0; i < 4; i++) { ctx.fillStyle = `rgba(60,60,90,${0.08 + r() * 0.1})`; ctx.beginPath(); ctx.ellipse((r() - 0.5) * R * 1.4, (r() - 0.5) * R * 1.4, R * (0.3 + r() * 0.3), R * (0.2 + r() * 0.2), r() * 3, 0, Math.PI * 2); ctx.fill(); }
  for (let i = 0; i < 9; i++) {
    const x = (r() - 0.5) * R * 1.7, y = (r() - 0.5) * R * 1.7, cr = R * (0.05 + r() * 0.14);
    ctx.fillStyle = "rgba(20,20,40,0.28)"; ctx.beginPath(); ctx.arc(x, y, cr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = cr * 0.3; ctx.beginPath(); ctx.arc(x, y, cr, 0.1, 1.9); ctx.stroke();
  }
  ctx.restore();
  shade(ctx, R, 0.85);
  return col[0];
}

function atmosphere(ctx: CanvasRenderingContext2D, R: number, color: string) {
  const g = ctx.createRadialGradient(0, 0, R * 0.92, 0, 0, R * 1.32);
  g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 1.32, 0, Math.PI * 2); ctx.fill();
}

function planet(ctx: CanvasRenderingContext2D, R: number, r: () => number, terran: boolean) {
  const pal = terran
    ? pick(r, [{ base: "#1f5fbf", land: "#3fae6a", atmo: "rgba(120,200,255,0.55)" }, { base: "#164a8a", land: "#c9b27a", atmo: "rgba(140,220,255,0.5)" }, { base: "#2a7a8f", land: "#7ad16b", atmo: "rgba(140,255,220,0.45)" }])
    : pick(r, [{ base: "#b5502e", land: "#e08a4f", atmo: "rgba(255,160,110,0.45)" }, { base: "#5b3d9c", land: "#9b7be0", atmo: "rgba(190,150,255,0.5)" }, { base: "#2f8a6b", land: "#9fe0a8", atmo: "rgba(140,255,200,0.45)" }, { base: "#3b5fa8", land: "#8fb0e8", atmo: "rgba(150,190,255,0.5)" }]);
  atmosphere(ctx, R, pal.atmo);
  ctx.fillStyle = pal.base; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  for (let k = 0; k < 4; k++) {
    const cx = (r() - 0.5) * R * 1.6, cy = (r() - 0.5) * R * 1.6;
    ctx.fillStyle = pal.land;
    for (let i = 0; i < 6; i++) { ctx.globalAlpha = 0.7 + r() * 0.3; ctx.beginPath(); ctx.arc(cx + (r() - 0.5) * R * 0.6, cy + (r() - 0.5) * R * 0.6, R * (0.12 + r() * 0.22), 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 6; i++) { ctx.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.25})`; ctx.beginPath(); ctx.ellipse((r() - 0.5) * R * 1.8, (r() - 0.5) * R * 1.8, R * (0.3 + r() * 0.5), R * (0.05 + r() * 0.07), (r() - 0.5) * 0.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  shade(ctx, R, 0.88);
  ctx.strokeStyle = pal.atmo; ctx.lineWidth = Math.max(1, R * 0.06); ctx.beginPath(); ctx.arc(0, 0, R * 0.98, Math.PI * 0.9, Math.PI * 1.75); ctx.stroke();
  return pal.land;
}

function gas(ctx: CanvasRenderingContext2D, R: number, r: () => number) {
  const bands = pick(r, [["#f0d3a0", "#c98f5a", "#f6e6c8", "#a8673f", "#e2b27a"], ["#a9dcef", "#5b8fc9", "#d4eef7", "#3f6aa8", "#8ec5e6"], ["#e2b6ef", "#8a5bc9", "#f3dcf7", "#6a3fa8", "#c793e0"], ["#f2c4a0", "#d9655b", "#f8e0c8", "#a8433f", "#e89a7a"]]);
  const ringed = r() < 0.65;
  const ring = (front: boolean) => {
    ctx.save(); ctx.rotate(-0.35); ctx.scale(1, 0.26);
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = i % 2 ? `rgba(255,240,220,${0.25 + r() * 0.2})` : `rgba(${bands[1] === "#5b8fc9" ? "170,220,255" : "230,200,170"},${0.35 + r() * 0.25})`;
      ctx.lineWidth = R * (0.06 + r() * 0.08);
      ctx.beginPath(); ctx.arc(0, 0, R * (1.4 + i * 0.16), front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  };
  if (ringed) ring(false);
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  ctx.rotate(-0.12);
  let y = -R * 1.1; let i = 0;
  while (y < R * 1.1) { const h = R * (0.08 + r() * 0.16); ctx.fillStyle = bands[i++ % bands.length]; ctx.fillRect(-R * 1.2, y, R * 2.4, h + 1); y += h; }
  for (let k = 0; k < 8; k++) { ctx.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`; ctx.fillRect(-R * 1.2, (r() - 0.5) * R * 2, R * 2.4, R * 0.03); }
  ctx.fillStyle = "rgba(170,60,40,0.55)"; ctx.beginPath(); ctx.ellipse(R * (r() - 0.3) * 0.8, R * 0.3, R * 0.2, R * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  shade(ctx, R, 0.9);
  if (ringed) ring(true);
  return bands[0];
}

function star(ctx: CanvasRenderingContext2D, R: number, r: () => number) {
  const p = pick(r, [["#fffbe8", "#ffd36b", "#ff8a3d"], ["#f4faff", "#a8d6ff", "#4a7dff"], ["#fff0e0", "#ff9a6b", "#e0402a"], ["#ffffff", "#fff2b0", "#ffc04a"]]);
  const g = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 2.4);
  g.addColorStop(0, p[2] + "aa"); g.addColorStop(0.4, p[2] + "33"); g.addColorStop(1, p[2] + "00");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 2.4, 0, Math.PI * 2); ctx.fill();
  const c = ctx.createRadialGradient(-R * 0.2, -R * 0.2, 0, 0, 0, R);
  c.addColorStop(0, p[0]); c.addColorStop(0.55, p[1]); c.addColorStop(1, p[2]);
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(255,255,255,${r() * 0.18})`; ctx.beginPath(); ctx.arc((r() - 0.5) * R * 2, (r() - 0.5) * R * 2, R * (0.04 + r() * 0.08), 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  return p[2];
}

function neutron(ctx: CanvasRenderingContext2D, R: number) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 3);
  g.addColorStop(0, "rgba(200,240,255,0.9)"); g.addColorStop(0.25, "rgba(90,180,255,0.45)"); g.addColorStop(1, "rgba(60,80,255,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 3, 0, Math.PI * 2); ctx.fill();
  const c = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  c.addColorStop(0, "#ffffff"); c.addColorStop(0.6, "#bfe6ff"); c.addColorStop(1, "#5a8cff");
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(200,240,255,0.7)"; ctx.lineWidth = R * 0.08;
  ctx.beginPath(); ctx.arc(0, 0, R * 1.35, 0, Math.PI * 2); ctx.stroke();
  return "#8fd0ff";
}

function relic(ctx: CanvasRenderingContext2D, R: number, r: () => number, v: number) {
  const pal = [["#34e89e", "#ff4fd8"], ["#ffd36b", "#9b5cff"], ["#38d9f5", "#ff3b6b"], ["#b6ff6b", "#38a1ff"]][v % 4];
  const g = ctx.createRadialGradient(0, 0, R * 0.3, 0, 0, R * 2.1);
  g.addColorStop(0, pal[1] + "88"); g.addColorStop(1, pal[1] + "00");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 2.1, 0, Math.PI * 2); ctx.fill();
  const n = 7 + (v % 3);
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2; const d = i % 2 ? R * (0.45 + r() * 0.15) : R * (0.85 + r() * 0.15); ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
  ctx.closePath();
  const f = ctx.createLinearGradient(-R, -R, R, R); f.addColorStop(0, pal[0]); f.addColorStop(1, pal[1]);
  ctx.fillStyle = f; ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1.5; ctx.stroke();
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9); ctx.stroke(); }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.35); core.addColorStop(0, "#ffffff"); core.addColorStop(1, pal[0] + "00");
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, R * 0.35, 0, Math.PI * 2); ctx.fill();
  return pal[0];
}
