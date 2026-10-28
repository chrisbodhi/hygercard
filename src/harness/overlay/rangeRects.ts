import type { Rect } from "./geometry";

/**
 * A DOM range's line boxes, in the overlay root's coordinates (its padding box,
 * the origin an absolutely positioned child is placed from). Empty boxes, which
 * collapsed text and hidden elements produce, are dropped.
 */
export function rangeRects(range: Range, overlayRoot: Element): Rect[] {
  const origin = overlayRoot.getBoundingClientRect();
  const dx = origin.left + overlayRoot.clientLeft;
  const dy = origin.top + overlayRoot.clientTop;
  return [...range.getClientRects()]
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ left: r.left - dx, top: r.top - dy, right: r.right - dx, bottom: r.bottom - dy }));
}

/** An element's box in the overlay root's coordinates, or null when it has none. */
export function elementRect(element: Element, overlayRoot: Element): Rect | null {
  const origin = overlayRoot.getBoundingClientRect();
  const r = element.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const dx = origin.left + overlayRoot.clientLeft;
  const dy = origin.top + overlayRoot.clientTop;
  return { left: r.left - dx, top: r.top - dy, right: r.right - dx, bottom: r.bottom - dy };
}
