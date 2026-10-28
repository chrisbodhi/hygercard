// A rendered item's text content, and the mapping between it and the DOM.
//
// core/textContent.ts defines §10.2 text content over a stream of text pieces
// and block breaks. This walks a rendered node tree into that same stream, with
// the same tag sets, so a DOM selection becomes offsets into the spec's text
// content by arithmetic, not by searching for the selected string. The same
// mapping run the other way finds the DOM range for an offset range, which is
// how a band reaches the passage a partial quote came from.
//
// The walked tree is the sanitized one. If sanitizing changed the text, the
// stored item's text content (what the spec checks against) is what counts, and
// `readSelection` says so.

import { BLOCK_END_TAGS, BREAK_TAGS, layout, selectRaw, SKIPPED_TAGS, type Piece, type TextLayout } from "../core/textContent";

export interface DomText {
  layout: TextLayout;
  /** Each text node walked, with the raw index of its first character. */
  nodes: ReadonlyArray<{ node: Text; start: number }>;
  /** For each offset in `layout.text`, the raw index of the character there; -1 for a line break or collapsed space. */
  rawAt: Int32Array;
}

/** Walk the children of `root` (the root itself is not a block) into a text layout. */
export function domText(root: Node): DomText {
  const pieces: Piece[] = [];
  const nodes: Array<{ node: Text; start: number }> = [];
  let raw = 0;

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      pieces.push(text.data);
      nodes.push({ node: text, start: raw });
      raw += text.data.length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).localName;
    if (SKIPPED_TAGS.has(tag)) return;
    if (BREAK_TAGS.has(tag)) pieces.push(null);
    for (const child of node.childNodes) walk(child);
    if (BLOCK_END_TAGS.has(tag)) pieces.push(null);
  };
  for (const child of root.childNodes) walk(child);

  const built = layout(pieces);
  const rawAt = new Int32Array(built.text.length).fill(-1);
  for (let i = 0; i < built.raw.length; i++) if (!/\s/.test(built.raw[i]!)) rawAt[built.offsetOfRaw[i]!] = i;
  return { layout: built, nodes, rawAt };
}

/** The raw character range a DOM range covers, or null if it covers no text. */
function rawRange(dt: DomText, range: Range): [number, number] | null {
  let from = -1;
  let to = -1;
  for (const { node, start } of dt.nodes) {
    if (!range.intersectsNode(node)) continue;
    const lo = node === range.startContainer ? range.startOffset : 0;
    const hi = node === range.endContainer ? range.endOffset : node.data.length;
    if (hi <= lo) continue;
    if (from < 0) from = start + lo;
    to = start + hi;
  }
  return from < 0 ? null : [from, to];
}

/** The offsets into the walked text content that a DOM range selects, or null if only whitespace. */
export function selectionOffsets(dt: DomText, range: Range): { start: number; end: number; exact: string } | null {
  const covered = rawRange(dt, range);
  return covered ? selectRaw(dt.layout, covered[0], covered[1]) : null;
}

export type SelectionReading =
  | { valid: true; start: number; end: number; exact: string }
  | { valid: false; reason: string; start?: number; end?: number; exact?: string };

/**
 * Read a selection against the item's stored text content, the text the spec's
 * substring check (§10.2) is made against. When the rendered text is the stored
 * text, which it is unless sanitizing removed something, the offsets are exact.
 */
export function readSelection(dt: DomText, range: Range, storedText: string): SelectionReading {
  const hit = selectionOffsets(dt, range);
  if (!hit) return { valid: false, reason: "only whitespace is selected" };
  if (dt.layout.text === storedText) return { valid: true, ...hit };
  const at = storedText.indexOf(hit.exact);
  if (at < 0) {
    return { valid: false, ...hit, reason: "the selection is not in the item's stored text content: sanitizing changed what is rendered" };
  }
  return { valid: true, start: at, end: at + hit.exact.length, exact: hit.exact };
}

/** The node and offset of a raw character index. */
function pointOf(dt: DomText, raw: number): { node: Text; offset: number } | null {
  let lo = 0;
  let hi = dt.nodes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = dt.nodes[mid]!;
    if (raw < entry.start) hi = mid - 1;
    else if (raw >= entry.start + entry.node.data.length) lo = mid + 1;
    else return { node: entry.node, offset: raw - entry.start };
  }
  return null;
}

/** The DOM range for offsets [start, end) into the walked text content: the inverse of `selectionOffsets`. */
export function rangeFromOffsets(dt: DomText, start: number, end: number): Range | null {
  let first = start;
  let last = end - 1;
  while (first <= last && dt.rawAt[first] === -1) first++;
  while (last >= first && dt.rawAt[last] === -1) last--;
  if (first > last) return null;
  const a = pointOf(dt, dt.rawAt[first]!);
  const b = pointOf(dt, dt.rawAt[last]!);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset + 1);
  return range;
}
