// §10.2 "text content": an item's `content_html` with tags stripped, whitespace
// collapsed within a block, and block boundaries kept as line breaks. A partial
// quote's selection must be a substring of it, at the version being baked.
//
// The spec gives that sentence and no more. These are the rules this file
// settles it with; they follow the reference implementation (blygger-studio,
// src/markdown.ts `selectionText`) except where the README's disagreement list
// says otherwise.
//
//   - Entities are decoded, numeric ones included (the text is what a reader
//     sees, and what a browser selection yields).
//   - <script> and <style> contribute nothing.
//   - A block boundary falls at the END of p, h1-h6, li, blockquote, pre, div,
//     tr, section and article, and at every <br>.
//   - Whitespace runs inside a block collapse to one space; a block is trimmed;
//     empty blocks vanish; the surviving blocks are joined with "\n".
//
// The work is split in two so that a browser can share it. `piecesOf` turns an
// HTML string into a stream of text pieces and block breaks; a DOM walker can
// build the same stream from a rendered node tree. `layout` normalizes any such
// stream and remembers where every raw character landed, which is what lets a
// DOM selection be turned into offsets by arithmetic instead of by searching.

import { Parser } from "htmlparser2";
import type { Selector } from "./types";

/** A piece of text, or `null` for a block boundary. */
export type Piece = string | null;

export const BLOCK_END_TAGS: ReadonlySet<string> = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "div", "tr", "section", "article",
]);
export const BREAK_TAGS: ReadonlySet<string> = new Set(["br"]);
export const SKIPPED_TAGS: ReadonlySet<string> = new Set(["script", "style"]);

/** The text pieces and block boundaries of an HTML string, in document order. */
export function piecesOf(html: string): Piece[] {
  const pieces: Piece[] = [];
  let skipping = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (SKIPPED_TAGS.has(name)) skipping++;
        else if (BREAK_TAGS.has(name) && !skipping) pieces.push(null);
      },
      onclosetag(name) {
        if (SKIPPED_TAGS.has(name)) skipping = Math.max(0, skipping - 1);
        else if (BLOCK_END_TAGS.has(name) && !skipping) pieces.push(null);
      },
      ontext(text) {
        if (!skipping) pieces.push(text);
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return pieces;
}

const WHITESPACE = /\s/;
const isSpace = (char: string) => WHITESPACE.test(char);

export interface TextLayout {
  /** The text content. */
  text: string;
  /** Every text piece concatenated, boundaries excluded: the "raw characters" below. */
  raw: string;
  /**
   * For each raw character, the offset in `text` it landed on. Exact for every
   * character that is not whitespace; whitespace is collapsed or trimmed, so
   * its entry only says roughly where it was.
   */
  offsetOfRaw: Int32Array;
}

/** Normalize a stream of pieces into text content, remembering where each raw character went. */
export function layout(pieces: readonly Piece[]): TextLayout {
  const raw = pieces.filter((piece): piece is string => piece !== null).join("");
  const offsetOfRaw = new Int32Array(raw.length);

  let text = "";
  let consumed = 0;
  let block: string[] = [];

  const flush = () => {
    const chars = block.join("");
    block = [];

    // Collapse and trim, recording each character's offset relative to the block.
    const out: string[] = [];
    const local = new Int32Array(chars.length);
    let pendingSpace = false;
    let outLength = 0;
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]!;
      if (isSpace(char)) {
        pendingSpace = outLength > 0;
        local[i] = pendingSpace ? outLength : 0;
        continue;
      }
      if (pendingSpace) {
        out.push(" ");
        outLength++;
        pendingSpace = false;
      }
      local[i] = outLength;
      out.push(char);
      outLength++;
    }
    // A trailing whitespace run points at the block's end, where the next boundary is.
    for (let i = chars.length - 1; i >= 0 && isSpace(chars[i]!); i--) local[i] = outLength;
    // Leading whitespace was recorded as offset 0 above, which is already the block's start.

    const segment = out.join("");
    const joiner = segment !== "" && text !== "" ? "\n" : "";
    const base = text.length + joiner.length;
    for (let i = 0; i < chars.length; i++) offsetOfRaw[consumed + i] = segment === "" ? text.length : base + local[i]!;
    consumed += chars.length;
    text += joiner + segment;
  };

  for (const piece of pieces) {
    if (piece === null) flush();
    else block.push(piece);
  }
  flush();
  return { text, raw, offsetOfRaw };
}

/** §10.2 text content of an `content_html` string. */
export function textContent(html: string): string {
  return layout(piecesOf(html)).text;
}

/**
 * Turn a range of raw characters (`rawStart` inclusive, `rawEnd` exclusive)
 * into a selection over the text content: its offsets and its exact text.
 * Whitespace at either edge is trimmed first, because a block is trimmed and so
 * is the quote; that leaves both ends on real characters, whose offsets are
 * exact. `null` when nothing but whitespace is selected.
 */
export function selectRaw(
  { text, raw, offsetOfRaw }: TextLayout,
  rawStart: number,
  rawEnd: number,
): { start: number; end: number; exact: string } | null {
  let from = Math.max(0, rawStart);
  let to = Math.min(raw.length, rawEnd);
  while (from < to && isSpace(raw[from]!)) from++;
  while (to > from && isSpace(raw[to - 1]!)) to--;
  if (from >= to) return null;
  const start = offsetOfRaw[from]!;
  const end = offsetOfRaw[to - 1]! + 1;
  return { start, end, exact: text.slice(start, end) };
}

/** How much context either side of a match to record. §10.3 says "short". */
const CONTEXT = 32;

/**
 * Where `selection` first occurs in `text`, as a text-quote selector with short
 * context; `null` when it does not occur, which at publish is an error (§10.2).
 * Context comes from the first match when there are several: `prefix` and
 * `suffix` are a relocation hint for readers and never part of the check.
 */
export function selectorFor(text: string, selection: string): Selector | null {
  if (selection === "") return null;
  const at = text.indexOf(selection);
  if (at < 0) return null;
  const prefix = text.slice(Math.max(0, at - CONTEXT), at);
  const suffix = text.slice(at + selection.length, at + selection.length + CONTEXT);
  return { exact: selection, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) };
}
