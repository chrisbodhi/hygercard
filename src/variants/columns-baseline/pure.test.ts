import { describe, expect, it } from "vitest";
import { changedLines, excerpt, nearestBoundary } from "./pure";

describe("nearestBoundary", () => {
  it("snaps a pointer anywhere over a block to the nearest boundary zone", () => {
    const centres = [10, 120, 300, 340];
    expect(nearestBoundary(centres, -50)).toBe(0);
    expect(nearestBoundary(centres, 60)).toBe(0); // the middle of the first block, a little nearer the top
    expect(nearestBoundary(centres, 70)).toBe(1);
    expect(nearestBoundary(centres, 200)).toBe(1);
    expect(nearestBoundary(centres, 215)).toBe(2);
    expect(nearestBoundary(centres, 1000)).toBe(3);
  });

  it("takes the earlier boundary on a tie, and works with one zone", () => {
    expect(nearestBoundary([0, 100], 50)).toBe(0);
    expect(nearestBoundary([42], 9000)).toBe(0);
  });
});

describe("changedLines", () => {
  it("finds what a gesture wrote", () => {
    expect(changedLines("a\nb\nc", "a\nb\nNEW\nc")).toEqual({ start: 2, end: 3 });
    expect(changedLines("a\nb", "a\nb\nc\nd")).toEqual({ start: 2, end: 4 });
    expect(changedLines("a\nb", "z\na\nb")).toEqual({ start: 0, end: 1 });
  });

  it("finds nothing when nothing changed, and everything when everything did", () => {
    expect(changedLines("a\nb", "a\nb")).toEqual({ start: 2, end: 2 });
    expect(changedLines("a", "x\ny")).toEqual({ start: 0, end: 2 });
  });

  it("does not let the common head and tail overlap on repeated lines", () => {
    const { start, end } = changedLines("x\nx", "x\nx\nx");
    expect(end - start).toBe(1);
  });
});

describe("excerpt", () => {
  it("flattens whitespace and clips", () => {
    expect(excerpt("a\n\n  b   c")).toBe("a b c");
    expect(excerpt("x".repeat(100), 10)).toBe("x".repeat(10) + "…");
  });
});
