import { describe, expect, it } from "vitest";
import { kindAt, topEligibleIndex } from "./data";
import { addMass, canAbsorb, defaultSave, formatMass, recordAbsorb, unlockAchievements, validateSave } from "./logic";

describe("endless rules", () => {
  it("tiny black hole can absorb debris but not a gas giant", () => {
    expect(canAbsorb(10, 0)).toBe(true);
    expect(canAbsorb(10, 7)).toBe(false);
  });
  it("mass never decreases or becomes Infinity", () => {
    expect(addMass(100, -5)).toBe(100);
    expect(addMass(1e300, 1e300)).toBe(1e300);
  });
  it("formats big numbers", () => {
    expect(formatMass(950)).toBe("950");
    expect(formatMass(1234)).toBe("1.23K");
    expect(formatMass(3.5e6)).toBe("3.50M");
    expect(formatMass(2.1e9)).toBe("2.10B");
    expect(formatMass(4.7e12)).toBe("4.70T");
    expect(formatMass(Infinity)).not.toContain("Infinity");
  });
  it("achievements unlock at thresholds, only once", () => {
    const s = { ...defaultSave(), stats: recordAbsorb(defaultSave().stats, kindAt(0)) };
    const a = unlockAchievements(s, 1000);
    expect(a.save.achievements).toEqual(["first", "m1e2", "m1e3"]);
    expect(unlockAchievements(a.save, 1000).unlocked).toHaveLength(0);
    expect(unlockAchievements(a.save, 9999).unlocked).toHaveLength(0);
  });
  it("universe keeps generating bigger objects", () => {
    expect(kindAt(60).minMass).toBeGreaterThan(kindAt(59).minMass);
    expect(topEligibleIndex(1e20)).toBeGreaterThan(topEligibleIndex(1e10));
  });
  it("corrupted save keeps valid fields", () => {
    const s = validateSave({ bestMass: 5000, achievements: ["bogus"], skin: "crown" });
    expect(s.bestMass).toBe(5000);
    expect(s.skin).toBe("horizon");
    expect(s.achievements).toContain("m1e3");
    expect(validateSave("garbage").bestMass).toBe(0);
  });
});
