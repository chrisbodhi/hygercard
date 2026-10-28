// Operations on a draft's `content_md`. The string is the draft: every gesture
// takes it and returns a new one, and undo/redo is a stack of earlier strings.
// Nothing else needs persisting.
//
// A "boundary" is a position between blocks: 0 is before the first block,
// `blocks.length` after the last. Drops land on boundaries only.

import { directiveLine, eolOf, parse, quoteFor } from "./grammar";

/** Join block texts so that each block but the last ends in a blank line and cannot attach to its neighbour. */
function join(raws: string[], eol: string): string {
  return raws
    .map((raw, i) => {
      if (i === raws.length - 1) return raw;
      let separated = raw;
      if (!separated.endsWith("\n")) separated += eol;
      if (!/(?:^|\n)[ \t]*\r?\n$/.test(separated)) separated += eol;
      return separated;
    })
    .join("");
}

function splice(md: string, boundary: number, insert: string): string {
  const raws = parse(md).map((block) => block.raw);
  raws.splice(Math.max(0, Math.min(boundary, raws.length)), 0, insert);
  return join(raws, eolOf(md));
}

/** Add a paragraph of the author's own words. */
export function insertProse(md: string, boundary: number, text: string): string {
  return splice(md, boundary, proseText(text) + eolOf(md));
}

/** Write a whole quote: `![[id]]` on its own line. */
export function insertWholeQuote(md: string, boundary: number, id: string, label?: string | null): string {
  return splice(md, boundary, directiveLine(id, label) + eolOf(md));
}

/** Write a partial quote: the directive, and the selection as an attached blockquote. */
export function insertPartialQuote(md: string, boundary: number, id: string, selection: string, label?: string | null): string {
  const eol = eolOf(md);
  return splice(md, boundary, directiveLine(id, label) + eol + quoteFor(selection, eol));
}

/** Move the block at `from` to a boundary, counted in the blocks as they are now. */
export function moveBlock(md: string, from: number, boundary: number): string {
  const raws = parse(md).map((block) => block.raw);
  if (from < 0 || from >= raws.length || boundary === from || boundary === from + 1) return md;
  const [moved] = raws.splice(from, 1);
  raws.splice(boundary > from ? boundary - 1 : boundary, 0, moved!);
  return join(raws, eolOf(md));
}

export function removeBlock(md: string, index: number): string {
  const raws = parse(md).map((block) => block.raw);
  if (index < 0 || index >= raws.length) return md;
  raws.splice(index, 1);
  return join(raws, eolOf(md));
}

/** A prose block's text without the blank lines that trail it, which belong to the seam. */
export function proseText(raw: string): string {
  return raw.replace(/(?:\r?\n[ \t]*)+$/, "");
}

/** Replace a prose block's text, keeping its trailing separator. Empty text removes the block. */
export function editProse(md: string, index: number, text: string): string {
  const blocks = parse(md);
  const block = blocks[index];
  if (!block || block.kind !== "prose") return md;
  if (text.trim() === "") return removeBlock(md, index);
  const trailing = block.raw.slice(proseText(block.raw).length);
  const raws = blocks.map((b) => b.raw);
  raws[index] = proseText(text) + (trailing || (index < raws.length - 1 ? eolOf(md) : ""));
  return join(raws, eolOf(md));
}

// --- Undo / redo -------------------------------------------------------------

export interface History {
  past: string[];
  present: string;
  future: string[];
}

const LIMIT = 200;

export const startHistory = (md: string): History => ({ past: [], present: md, future: [] });

/** Record a new state. A no-op edit records nothing. */
export function commit(history: History, md: string): History {
  if (md === history.present) return history;
  return { past: [...history.past, history.present].slice(-LIMIT), present: md, future: [] };
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}
