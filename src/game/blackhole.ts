// Black hole renderer, shared by gameplay and the hangar preview.
import type { Skin } from "./data";

// Return hex so all shared renderers can safely append an alpha byte.
function hsl(h: number, s = 90, l = 65) {
  const hue = ((h % 360) + 360) % 360;
  const light = l / 100;
  const amplitude = (s / 100) * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = light - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function skinColors(skin: Skin, t: number) {
  if (!skin.animated) return skin;
  const h = t * 50;
  return { ...skin, mid: hsl(h), outer: hsl(h + 120), glow: hsl(h + 240, 90, 70), hot: "#ffffff" };
}

/** Draw at screen position (x,y), r = event-horizon radius in px. */
export function drawBlackHole(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, skinIn: Skin, reduced: boolean, pulse = 0) {
  if (![x, y, r, t, pulse].every(Number.isFinite) || r <= 0) return;
  pulse = Math.max(0, pulse);
  const skin = skinColors(skinIn, t);
  if (r < 1.5) {
    ctx.fillStyle = skin.glow; ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skin.hot; ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.arc(x, y, 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  const TILT = -0.22, FLAT = 0.34;
  // halo
  const halo = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * (3.4 + pulse));
  halo.addColorStop(0, skin.glow + "66"); halo.addColorStop(0.35, skin.glow + "22"); halo.addColorStop(1, skin.glow + "00");
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r * (3.4 + pulse), 0, Math.PI * 2); ctx.fill();

  const bands = [
    { R: 1.45, w: 0.34, c: skin.hot, s: 1.9, a: 0.95 },
    { R: 1.85, w: 0.3, c: skin.mid, s: 1.3, a: 0.8 },
    { R: 2.3, w: 0.26, c: skin.outer, s: 0.8, a: 0.55 },
  ];
  const segs = reduced ? 18 : 32;
  const disk = (front: boolean) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(TILT); ctx.scale(1, FLAT);
    ctx.lineCap = "butt";
    for (const b of bands) {
      ctx.strokeStyle = b.c; ctx.lineWidth = r * b.w;
      for (let i = 0; i < segs; i++) {
        const a0 = (front ? 0 : Math.PI) + (i / segs) * Math.PI;
        const a1 = a0 + Math.PI / segs + 0.01;
        const swirl = 0.5 + 0.5 * Math.sin(a0 * 3 - t * b.s * 2.2);
        const doppler = 0.65 + 0.35 * Math.cos(a0);
        ctx.globalAlpha = b.a * (0.35 + 0.65 * swirl) * doppler * (front ? 1 : 0.8);
        ctx.beginPath(); ctx.arc(0, 0, r * b.R, a0, a1); ctx.stroke();
      }
    }
    ctx.restore(); ctx.globalAlpha = 1;
  };
  disk(false);
  // lensed far side of the disk arcing over the horizon
  ctx.globalAlpha = 0.55; ctx.strokeStyle = skin.mid; ctx.lineWidth = r * 0.18;
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.22, r * 1.12, TILT, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  ctx.globalAlpha = 1;
  // horizon
  const h = ctx.createRadialGradient(x, y, 0.001, x, y, r);
  h.addColorStop(0, "#000000"); h.addColorStop(0.85, "#020008"); h.addColorStop(1, "#0b0420");
  ctx.fillStyle = h; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  // photon ring
  ctx.strokeStyle = skin.hot; ctx.globalAlpha = 0.9; ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath(); ctx.arc(x, y, r * 1.03, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.3; ctx.lineWidth = Math.max(2, r * 0.18); ctx.strokeStyle = skin.mid;
  ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  disk(true);
  // spiral particles
  const n = reduced ? 14 : 36;
  ctx.fillStyle = skin.hot;
  for (let i = 0; i < n; i++) {
    const ph = (t * (0.18 + (i % 5) * 0.03) + i * 0.137) % 1;
    const d = r * (3.1 - 2.0 * ph);
    const a = i * 2.39 + ph * 7 + t * 0.6;
    const px = Math.cos(a) * d, py = Math.sin(a) * d * FLAT;
    const cs = Math.cos(TILT), sn = Math.sin(TILT);
    ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.9;
    ctx.fillStyle = i % 3 ? skin.hot : skin.mid;
    ctx.beginPath(); ctx.arc(x + px * cs - py * sn, y + px * sn + py * cs, Math.max(0.8, r * 0.045), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
