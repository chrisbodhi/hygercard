import { describe, expect, it } from "vitest";
import { bandPath, boundsOf, clampExtent, endpointOf, intersect, sameEndpoint, STUB } from "./geometry";

const view = { top: 100, bottom: 500 };

describe("clampExtent", () => {
  it("leaves a visible extent alone", () => {
    expect(clampExtent(200, 260, view)).toEqual({ top: 200, bottom: 260, clamp: null });
  });

  it("trims a partly visible extent to the window without calling it clamped", () => {
    expect(clampExtent(60, 140, view)).toEqual({ top: 100, bottom: 140, clamp: null });
    expect(clampExtent(480, 620, view)).toEqual({ top: 480, bottom: 500, clamp: null });
  });

  it("pins an extent scrolled above to the top edge, as a stub", () => {
    expect(clampExtent(10, 90, view)).toEqual({ top: 100, bottom: 100 + STUB, clamp: "above" });
    expect(clampExtent(10, 100, view)).toMatchObject({ clamp: "above" });
  });

  it("pins an extent scrolled below to the bottom edge, as a stub", () => {
    expect(clampExtent(600, 700, view)).toEqual({ top: 500 - STUB, bottom: 500, clamp: "below" });
    expect(clampExtent(500, 700, view)).toMatchObject({ clamp: "below" });
  });

  it("an extent that spans the whole window is trimmed, not clamped", () => {
    expect(clampExtent(0, 900, view)).toEqual({ top: 100, bottom: 500, clamp: null });
  });

  it("never makes a stub taller than the window", () => {
    expect(clampExtent(0, 5, { top: 100, bottom: 103 })).toEqual({ top: 100, bottom: 103, clamp: "above" });
  });
});

describe("endpoints", () => {
  const rect = { left: 40, top: 200, right: 300, bottom: 260 };
  const window = { left: 0, top: 100, right: 400, bottom: 500 };

  it("attaches at the right edge for a source in a left column and the left edge for a center block", () => {
    expect(endpointOf(rect, "right", window)).toEqual({ x: 300, top: 200, bottom: 260, clamp: null });
    expect(endpointOf(rect, "left", window)).toEqual({ x: 40, top: 200, bottom: 260, clamp: null });
  });

  it("clamps vertically", () => {
    expect(endpointOf({ ...rect, top: 700, bottom: 760 }, "right", window)).toMatchObject({ x: 300, clamp: "below" });
  });
});

describe("rect helpers", () => {
  it("takes the union of rects, and nothing of none", () => {
    expect(boundsOf([{ left: 1, top: 5, right: 4, bottom: 8 }, { left: 0, top: 6, right: 3, bottom: 12 }])).toEqual({ left: 0, top: 5, right: 4, bottom: 12 });
    expect(boundsOf([])).toBeNull();
  });

  it("intersects, and says when there is nothing", () => {
    expect(intersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 20, bottom: 20 })).toEqual({ left: 5, top: 5, right: 10, bottom: 10 });
    expect(intersect({ left: 0, top: 0, right: 1, bottom: 1 }, { left: 5, top: 5, right: 6, bottom: 6 })).toBeNull();
  });

  it("compares endpoints by value", () => {
    const a = { x: 1, top: 2, bottom: 3, clamp: null } as const;
    expect(sameEndpoint(a, { ...a })).toBe(true);
    expect(sameEndpoint(a, { ...a, clamp: "above" })).toBe(false);
    expect(sameEndpoint(a, null)).toBe(false);
    expect(sameEndpoint(null, null)).toBe(true);
  });
});

describe("bandPath", () => {
  const from = { x: 100, top: 10, bottom: 50, clamp: null } as const;
  const to = { x: 300, top: 110, bottom: 130, clamp: null } as const;

  it("closes a ribbon between the two extents", () => {
    expect(bandPath(from, to, 0.5)).toBe("M 100 10 C 150 10 250 110 300 110 L 300 130 C 250 130 150 50 100 50 Z");
  });

  it("is straight-sided at zero curvature and clamps curvature to [0, 1]", () => {
    expect(bandPath(from, to, 0)).toBe("M 100 10 C 100 10 300 110 300 110 L 300 130 C 300 130 100 50 100 50 Z");
    expect(bandPath(from, to, 5)).toBe(bandPath(from, to, 1));
    expect(bandPath(from, to, -1)).toBe(bandPath(from, to, 0));
  });

  it("curves the other way for a band that runs leftward", () => {
    expect(bandPath(to, from, 1)).toContain("C 200 110 200 10");
  });
});
