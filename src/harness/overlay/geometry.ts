// Overlay geometry, kept pure. Coordinates are relative to the overlay root's
// padding box, so an absolutely positioned SVG layer can draw them as they are.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where an endpoint is scrolled to, relative to its container's visible window. */
export type Clamp = "above" | "below" | null;

/** One end of a band: a vertical extent at an x, pinned to the visible window when scrolled out. */
export interface Endpoint {
  x: number;
  top: number;
  bottom: number;
  clamp: Clamp;
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const out = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return out.left <= out.right && out.top <= out.bottom ? out : null;
}

/** How tall a clamped endpoint's stub is, so a band that has scrolled away still has somewhere to attach. */
export const STUB = 8;

/**
 * Clamp a vertical extent to the visible window. An extent that is wholly above
 * or below becomes a stub pinned to that edge and says which; one that is partly
 * visible is trimmed to the window and is not clamped.
 */
export function clampExtent(top: number, bottom: number, view: { top: number; bottom: number }): { top: number; bottom: number; clamp: Clamp } {
  if (bottom <= view.top) return { top: view.top, bottom: Math.min(view.top + STUB, view.bottom), clamp: "above" };
  if (top >= view.bottom) return { top: Math.max(view.bottom - STUB, view.top), bottom: view.bottom, clamp: "below" };
  return { top: Math.max(top, view.top), bottom: Math.min(bottom, view.bottom), clamp: null };
}

/** Read an endpoint off a target's rect, attached at `x` and clamped to `view`. */
export function endpointOf(rect: Rect, side: "left" | "right", view: Rect): Endpoint {
  return { x: side === "left" ? rect.left : rect.right, ...clampExtent(rect.top, rect.bottom, view) };
}

/**
 * A ribbon from one endpoint to another: the two vertical extents joined by
 * cubic curves whose handles are `curvature` (0 straight, 1 fully eased) of
 * the way across.
 */
export function bandPath(from: Endpoint, to: Endpoint, curvature: number): string {
  const reach = (to.x - from.x) * 0.5 * Math.max(0, Math.min(1, curvature));
  const f = (n: number) => Math.round(n * 100) / 100;
  return [
    `M ${f(from.x)} ${f(from.top)}`,
    `C ${f(from.x + reach)} ${f(from.top)} ${f(to.x - reach)} ${f(to.top)} ${f(to.x)} ${f(to.top)}`,
    `L ${f(to.x)} ${f(to.bottom)}`,
    `C ${f(to.x - reach)} ${f(to.bottom)} ${f(from.x + reach)} ${f(from.bottom)} ${f(from.x)} ${f(from.bottom)}`,
    "Z",
  ].join(" ");
}

export const sameEndpoint = (a: Endpoint | null, b: Endpoint | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.top === b.top && a.bottom === b.bottom && a.clamp === b.clamp);
