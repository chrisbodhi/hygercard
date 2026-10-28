// content_md <-> blocks (§10.1). The grammar is line-based:
//
//   directive    a line that is solely `![[id]]` or `![[id | label]]`
//   partial      a directive immediately followed, with no blank line, by a
//                blockquote (CommonMark's extent, lazy continuation included)
//   reserved     `![[id@vN]]`, which publishers must reject (§10.1)
//   prose        everything else, one block per top-level markdown block
//
// Inline `[[id]]` / `[[id | label]]` is a link, found inside prose blocks.
// Directives and links are inert inside code spans and code blocks; "code" is
// whatever markdown-it says is code (see markdown.ts `codeSpans`).
//
// Every block keeps its own raw text, blank separator lines included, so
// `serialize(parse(md)) === md` for every input by construction.

import { ID_SOURCE } from "./ids";
import { codeSpans, parseMarkdown, parserView, renderMarkdown } from "./markdown";
import { textContent } from "./textContent";

export interface InlineLink {
  id: string;
  label: string | null;
  /** Offsets into the owning prose block's `raw`. */
  start: number;
  end: number;
}

export interface ProseBlock {
  kind: "prose";
  raw: string;
  links: InlineLink[];
}

export interface DirectiveBlock {
  kind: "directive";
  raw: string;
  id: string;
  label: string | null;
}

export interface PartialBlock {
  kind: "partial";
  raw: string;
  id: string;
  label: string | null;
  /** The directive line, with its line ending. */
  directive: string;
  /** The attached blockquote, verbatim; blank lines after it stay in `raw`. */
  quote: string;
  /** The quote's text content: the selection, as §10.2 checks it. */
  selection: string;
}

export interface ReservedBlock {
  kind: "reserved";
  raw: string;
  id: string;
  version: number;
}

export type Block = ProseBlock | DirectiveBlock | PartialBlock | ReservedBlock;

// --- The bracket grammar ----------------------------------------------------

// After the id: an optional label (`|` then anything up to the first `]]`, so a
// label may contain a pipe), or for the directive form only, the reserved `@vN`.
const LABEL = String.raw`(?:[ \t]*\|((?:(?!\]\])[^\n])*))?`;
const BRACKETS = new RegExp(String.raw`(!?)\[\[(${ID_SOURCE})(?:@v(\d+)\]\]|${LABEL}\]\])`, "g");

interface Found {
  start: number;
  end: number;
  bang: boolean;
  id: string;
  label: string | null;
  version?: number;
}

function findBrackets(source: string): Found[] {
  const found: Found[] = [];
  for (const m of source.matchAll(BRACKETS)) {
    const bang = m[1] === "!";
    const version = m[3] === undefined ? undefined : Number(m[3]);
    if (version !== undefined && !bang) continue; // `[[id@v2]]` is not a link: literal text
    const label = m[4]?.trim();
    found.push({
      start: m.index,
      end: m.index + m[0].length,
      bang,
      id: m[2]!,
      label: label ? label : null,
      ...(version === undefined ? {} : { version }),
    });
  }
  return found;
}

// --- Lines ------------------------------------------------------------------

interface Line {
  text: string;
  /** "\n", "\r\n", or "" for an unterminated last line. A lone CR is not a line ending (§10.1). */
  eol: string;
  start: number;
}

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < source.length) {
    const lf = source.indexOf("\n", start);
    if (lf < 0) {
      lines.push({ text: source.slice(start), eol: "", start });
      break;
    }
    const crlf = lf > start && source[lf - 1] === "\r";
    lines.push({ text: source.slice(start, crlf ? lf - 1 : lf), eol: crlf ? "\r\n" : "\n", start });
    start = lf + 1;
  }
  return lines;
}

const rawOf = (lines: readonly Line[], from: number, to: number) =>
  lines.slice(from, to).map((line) => line.text + line.eol).join("");

const isBlank = (line: Line) => line.text.trim() === "";

/** The line ending the document uses, for text this module writes. */
export function eolOf(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

// --- parse ------------------------------------------------------------------

export function parse(source: string): Block[] {
  const lines = splitLines(source);
  const found = findBrackets(source);
  const { inert, tokens } = codeSpans(source, found.map((f) => [f.start, f.end] as const));
  const live = found.filter((_, index) => !inert.has(index));

  const lineStarts = lines.map((line) => line.start);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  // A directive is a live `![[…]]` that is the whole of its line.
  const directiveAt = new Map<number, Found>();
  const linksAt = new Map<number, Found[]>();
  for (const f of live) {
    const index = lineAt(f.start);
    const line = lines[index]!;
    if (!f.bang) {
      linksAt.set(index, [...(linksAt.get(index) ?? []), f]);
    } else if (
      line.text.slice(0, f.start - line.start).trim() === "" &&
      line.text.slice(f.end - line.start).trim() === ""
    ) {
      directiveAt.set(index, f);
    }
  }

  // Where a blockquote starts, and where CommonMark says it ends.
  const quoteEnds = new Map<number, number>();
  for (const token of tokens) {
    if (token.type === "blockquote_open" && token.map && !quoteEnds.has(token.map[0])) {
      quoteEnds.set(token.map[0], token.map[1]);
    }
  }
  const attachedQuoteEnd = (directiveLine: number) => {
    let end = quoteEnds.get(directiveLine + 1);
    if (end === undefined) return directiveLine + 1;
    end = Math.min(end, lines.length);
    // An all-`>` quote's extent can swallow the blank line after it; a blank line detaches.
    while (end > directiveLine + 2 && isBlank(lines[end - 1]!)) end--;
    return end;
  };

  const blocks: Block[] = [];
  const flushProse = (from: number, to: number) => {
    if (to > from) blocks.push(...proseBlocks(lines, from, to, linksAt));
  };

  let proseFrom = 0;
  for (let i = 0; i < lines.length; i++) {
    const d = directiveAt.get(i);
    if (!d) continue;
    flushProse(proseFrom, i);

    const quoteEnd = d.version === undefined ? attachedQuoteEnd(i) : i + 1;
    // The blank lines after a directive belong to it, as they do to a prose block.
    let end = quoteEnd;
    while (end < lines.length && isBlank(lines[end]!)) end++;

    const raw = rawOf(lines, i, end);
    if (d.version !== undefined) {
      blocks.push({ kind: "reserved", raw, id: d.id, version: d.version });
    } else if (quoteEnd > i + 1) {
      const quote = rawOf(lines, i + 1, quoteEnd);
      blocks.push({
        kind: "partial",
        raw,
        id: d.id,
        label: d.label,
        directive: rawOf(lines, i, i + 1),
        quote,
        selection: selectionOf(quote),
      });
    } else {
      blocks.push({ kind: "directive", raw, id: d.id, label: d.label });
    }
    i = end - 1;
    proseFrom = end;
  }
  flushProse(proseFrom, lines.length);
  return blocks;
}

/** Split lines [from, to) into one prose block per top-level markdown block. */
function proseBlocks(lines: readonly Line[], from: number, to: number, linksAt: Map<number, Found[]>): ProseBlock[] {
  const run = rawOf(lines, from, to);
  const starts = new Set<number>();
  for (const token of parseMarkdown(parserView(run))) {
    if (token.level === 0 && token.map && token.map[0] > 0) starts.add(token.map[0]);
  }
  // Blank lines trail the block before them, so the first block also takes any lead-in.
  const cuts = [0, ...[...starts].sort((a, b) => a - b), to - from];

  const blocks: ProseBlock[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const first = from + cuts[k]!;
    const last = from + cuts[k + 1]!;
    const links: InlineLink[] = [];
    const blockStart = lines[first]!.start;
    for (let index = first; index < last; index++) {
      for (const f of linksAt.get(index) ?? []) {
        links.push({ id: f.id, label: f.label, start: f.start - blockStart, end: f.end - blockStart });
      }
    }
    blocks.push({ kind: "prose", raw: rawOf(lines, first, last), links });
  }
  return blocks;
}

export function serialize(blocks: readonly Block[]): string {
  return blocks.map((block) => block.raw).join("");
}

// --- Selections -------------------------------------------------------------

/** The text content of a blockquote's markdown: what §10.2 calls the selection. */
export function selectionOf(quoteMarkdown: string): string {
  return textContent(renderMarkdown(quoteMarkdown));
}

// --- Writing the grammar ----------------------------------------------------

/** Text made safe as a label: one line, and no `]]`, which has no escape (§10.1). */
export function labelText(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/\](?=\]|$)/g, "] ");
}

/** `![[id]]` or `![[id | label]]`, without a line ending. */
export function directiveLine(id: string, label?: string | null): string {
  const text = label ? labelText(label) : "";
  return text ? `![[${id} | ${text}]]` : `![[${id}]]`;
}

const PUNCTUATION = /[!-/:-@[-`{-~]/g;

function escapeLine(line: string): string {
  return line
    .replace(/[\\`*_[\]<>~]/g, "\\$&")
    .replace(/&(?=#?\w+;)/g, "\\&")
    .replace(/^(#{1,6})(?=\s|$)/, "\\$1")
    .replace(/^([-+])/, "\\$1")
    .replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2");
}

/**
 * A markdown blockquote whose selection is exactly `selection`: one `>` line
 * per block of it, a bare `>` between blocks. Markdown punctuation in the text
 * is backslash-escaped, so what the author sees quoted is what gets checked;
 * if that does not round-trip, every ASCII punctuation mark is escaped.
 */
export function quoteFor(selection: string, eol = "\n"): string {
  const build = (escape: (line: string) => string) =>
    selection
      .split("\n")
      .map((line) => `> ${escape(line)}${eol}`)
      .join(`>${eol}`);
  for (const escape of [escapeLine, (line: string) => line.replace(PUNCTUATION, "\\$&")]) {
    const quote = build(escape);
    if (selectionOf(quote) === selection) return quote;
  }
  throw new Error(`cannot write a blockquote whose text content is ${JSON.stringify(selection)}`);
}
