import { describe, expect, it } from "vitest";
import { SKINS } from "./data";
import { drawBlackHole, skinColors } from "./blackhole";

describe("animated skin colors", () => {
  it("renders tiny opponents as particles without creating gradients", () => {
    let arcs = 0;
    const context = new Proxy({}, { get: (_target, key) => {
      if (key === "createRadialGradient") return () => { throw new Error("Tiny gradient"); };
      if (key === "arc") return (_x: number, _y: number, radius: number) => { expect(radius).toBeGreaterThan(0); arcs++; };
      return () => {};
    } });
    for (const r of [Number.MIN_VALUE, 0.001, 0.5, 1.49]) drawBlackHole(context as CanvasRenderingContext2D, 0, 0, r, 1, SKINS[0], false);
    expect(arcs).toBe(8);
  });
  it("rejects invalid coordinates and radii before touching Canvas", () => {
    let calls = 0;
    const context = new Proxy({}, { get: () => () => { calls++; } });
    for (const r of [NaN, Infinity, -1, 0]) drawBlackHole(context as CanvasRenderingContext2D, 0, 0, r, 0, SKINS[0], false);
    drawBlackHole(context as CanvasRenderingContext2D, NaN, 0, 10, 0, SKINS[0], false);
    expect(calls).toBe(0);
  });
  it("keeps animated colors compatible with every renderer's hex alpha suffix", () => {
    const animated = SKINS.filter((skin) => skin.animated);
    expect(animated.length).toBeGreaterThan(0);
    for (const skin of animated) {
      for (const time of [0, 1, 4.778, 100, 10000]) {
        const colors = skinColors(skin, time);
        for (const color of [colors.hot, colors.mid, colors.outer, colors.glow]) {
          expect(color).toMatch(/^#[0-9a-f]{6}$/i);
          for (const alpha of ["00", "22", "66"]) {
            expect(CSS_COLOR.test(color + alpha)).toBe(true);
          }
        }
        const gradient = { addColorStop: (_offset: number, color: string) => {
          if (!CSS_COLOR.test(color)) throw new Error(`Invalid gradient color: ${color}`);
        } };
        const context = new Proxy({}, { get: (_target, key) => key === "createRadialGradient" ? () => gradient : () => {} });
        expect(() => drawBlackHole(context as CanvasRenderingContext2D, 100, 100, 20, time, skin, false)).not.toThrow();
      }
    }
  });
});

const CSS_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;