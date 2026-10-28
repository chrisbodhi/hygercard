// The one CommonMark renderer, shared by the grammar (which needs its block
// parse to know what is code and where a blockquote ends) and the bake (which
// renders the draft's own prose with it).
//
// markdown-it, raw HTML off (§14: the draft's own markdown never injects
// markup). Options match the reference implementation so that a draft's prose
// bakes to the bytes the reference client would produce for it.

import MarkdownIt, { type Token } from "markdown-it";

export type { Token };

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
// markdown-it 15 turned fuzzy links (`blygger.com` without a scheme) off by default;
// the reference implementation runs 14, where they are on.
md.linkify.set({ fuzzyLink: true });

export type Env = Record<string, unknown>;

export function renderMarkdown(source: string, env: Env = {}): string {
  return md.render(source, env);
}

export function parseMarkdown(source: string, env: Env = {}): Token[] {
  return md.parse(source, env);
}

/**
 * The text markdown-it should see. A lone CR is a line ending to markdown-it
 * but not to §10.1 (a line ends at LF or CRLF), and the two must count lines
 * alike, so a lone CR is swapped for a character of the same length that is
 * not a line ending.
 */
export function parserView(source: string): string {
  return source.replace(/\r(?!\n)/g, " ");
}

/**
 * Which spans of `source` markdown-it reads as code (a code span, a fenced or
 * indented code block). Each span is swapped for a unique placeholder, the
 * result is parsed, and a span is code exactly when its placeholder comes out
 * inside a code token. That asks the renderer itself instead of re-deriving
 * its rules: backslash-escaped backticks, fences inside list items, spans that
 * run across lines and the rest are all the parser's call.
 *
 * Spans must not contain line breaks. Also returns the tokens of the
 * substituted parse, which callers reuse for block structure.
 */
export function codeSpans(
  source: string,
  spans: ReadonlyArray<readonly [start: number, end: number]>,
): { inert: Set<number>; tokens: Token[] } {
  const fence = placeholderCharacter(source);
  let view = "";
  let at = 0;
  spans.forEach(([start, end], index) => {
    view += source.slice(at, start) + `${fence}${index}${fence}`;
    at = end;
  });
  view += source.slice(at);

  const tokens = parseMarkdown(parserView(view));
  const inert = new Set<number>();
  const mark = (text: string) => {
    for (const m of text.matchAll(new RegExp(`${fence}(\\d+)${fence}`, "g"))) inert.add(Number(m[1]));
  };
  for (const token of tokens) {
    if (token.type === "fence" || token.type === "code_block") mark(token.content);
    for (const child of token.children ?? []) if (child.type === "code_inline") mark(child.content);
  }
  return { inert, tokens };
}

/** A private-use character that does not occur in `source`, so a placeholder cannot collide with it. */
export function placeholderCharacter(source: string): string {
  for (let code = 0xe000; code <= 0xf8ff; code++) {
    const char = String.fromCharCode(code);
    if (!source.includes(char)) return char;
  }
  throw new Error("no unused private-use character");
}
