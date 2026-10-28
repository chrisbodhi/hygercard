// Publish-time bake (§10.2): a draft's `content_md`, resolved against the local
// snapshot store, becomes `content_html` plus the `transclusions[]` and `links[]`
// that disclose what was copied and what was cited. Nothing here fetches.
//
// The result is kept per block so a preview can show an error on the block that
// caused it and point a band at the block that was baked.

import { absolutizeHtml, escapeHtml, pageUrl } from "./html";
import { parse, type Block, type ProseBlock } from "./grammar";
import { parseMarkdown, parserView, placeholderCharacter, renderMarkdown } from "./markdown";
import { resolve, type ResolveContext, type ResolveErrorCode, type Target } from "./resolve";
import type { Store } from "./store";
import { selectorFor, textContent } from "./textContent";
import type { LinkEntry, Transclusion } from "./types";

export type BakeErrorCode = ResolveErrorCode | "reserved" | "empty-selection" | "selection-not-found";

export interface BakeError {
  /** Index into `BakeResult.blocks`. */
  block: number;
  code: BakeErrorCode;
  /** The id the directive or link named, when there is one. */
  id?: string;
  message: string;
}

export interface BakedBlock {
  /** This block's contribution to `content_html`; empty when it failed. */
  html: string;
  transclusion?: Transclusion;
  links: LinkEntry[];
  errors: BakeError[];
}

export interface BakeResult {
  blocks: Block[];
  /** Parallel to `blocks`. */
  baked: BakedBlock[];
  html: string;
  /** In directive order (§10.3). */
  transclusions: Transclusion[];
  /** In document order (§10.3a). */
  links: LinkEntry[];
  errors: BakeError[];
}

export function bake(source: string, store: Store, ctx: ResolveContext): BakeResult {
  const blocks = parse(source);
  const baked = blocks.map((): BakedBlock => ({ html: "", links: [], errors: [] }));

  // Reference-style link definitions work across a run of prose blocks.
  const referencesFor = new Map<number, Record<string, unknown>>();
  for (let from = 0; from < blocks.length; ) {
    if (blocks[from]!.kind !== "prose") { from++; continue; }
    let to = from;
    while (to < blocks.length && blocks[to]!.kind === "prose") to++;
    const env: { references?: Record<string, unknown> } = {};
    parseMarkdown(parserView(blocks.slice(from, to).map((block) => block.raw).join("")), env);
    for (let i = from; i < to; i++) referencesFor.set(i, env.references ?? {});
    from = to;
  }

  blocks.forEach((block, index) => {
    const out = baked[index]!;
    const error = (code: BakeErrorCode, message: string, id?: string) =>
      out.errors.push({ block: index, code, message, ...(id ? { id } : {}) });

    if (block.kind === "prose") {
      out.html = bakeProse(block, referencesFor.get(index) ?? {}, store, ctx, out, error);
      return;
    }
    if (block.kind === "reserved") {
      return error("reserved", "explicit-version references (@vN) are reserved at this version and rejected at publish (§10.1)", block.id);
    }

    const resolution = resolve(store, ctx, block.id);
    if (!resolution.ok) return error(resolution.error.code, resolution.error.message, block.id);
    const { target } = resolution;

    let selector;
    if (block.kind === "partial") {
      if (block.selection === "") return error("empty-selection", "the attached blockquote is empty", block.id);
      selector = selectorFor(textContent(target.html), block.selection);
      if (!selector) return error("selection-not-found", `quoted passage not found in the target's version ${target.version}`, block.id);
    }

    out.transclusion = {
      id: target.id,
      version: target.version,
      ...(target.local ? {} : { origin: target.origin }),
      ...(selector ? { selector } : {}),
    };
    out.html = wrapper(target, selector?.exact, block.label);
  });

  // Parts are joined with "\n". A prose chunk is everything between two quotes, and
  // blank lines between quotes (or after the last) are a chunk that renders to
  // nothing but still takes its place in the join: the reference implementation
  // splits content_md the same way, so a thread it published re-bakes to its bytes.
  const parts: string[] = [];
  let run: string[] | null = null;
  const endRun = () => {
    if (run) parts.push(absolutizeHtml(run.join(""), ctx.origin));
    run = null;
  };
  blocks.forEach((block, index) => {
    if (block.kind === "prose") {
      (run ??= []).push(baked[index]!.html);
      return;
    }
    endRun();
    if (baked[index]!.html !== "") parts.push(baked[index]!.html);
    const next = blocks[index + 1];
    const blankAfter = /\n[ \t]*\r?\n$/.test(block.raw) || (next === undefined && block.raw.endsWith("\n"));
    if (next?.kind !== "prose" && blankAfter) parts.push("");
  });
  endRun();

  return {
    blocks,
    baked,
    html: parts.join("\n"),
    transclusions: baked.flatMap((b) => (b.transclusion ? [b.transclusion] : [])),
    links: baked.flatMap((b) => b.links),
    errors: baked.flatMap((b) => b.errors),
  };
}

/**
 * The §10.2 wrapper. `partial` is the selection's plain text; without it the
 * target's whole `content_html` is baked, made absolute against its own origin.
 *
 * Whitespace inside the wrapper is not normative in the spec's illustration; the
 * newlines here are the reference implementation's, and the README says so.
 */
function wrapper(target: Target, partial: string | undefined, label: string | null): string {
  const attributes = [
    `class="${partial === undefined ? "blyg-transclusion" : "blyg-transclusion blyg-partial"}"`,
    `data-blyg-id="${target.id}"`,
    `data-blyg-version="${target.version}"`,
    ...(target.local ? [] : [`data-blyg-origin="${escapeHtml(target.origin)}"`]),
    ...(label ? [`data-blyg-label="${escapeHtml(label)}"`] : []),
  ];
  const body =
    partial === undefined
      ? absolutizeHtml(target.html, target.origin)
      : partial.split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("\n");
  return `<blockquote ${attributes.join(" ")}>\n${body}\n</blockquote>`;
}

// --- Prose and `[[id]]` links ----------------------------------------------

interface Replacement {
  anchor: string;
  /** Where an anchor cannot go (inside another link): just the words. */
  text: string;
  /** Where nothing can go (inside a tag): the author's source, as written. */
  literal: string;
}

function bakeProse(
  block: ProseBlock,
  references: Record<string, unknown>,
  store: Store,
  ctx: ResolveContext,
  out: BakedBlock,
  error: (code: BakeErrorCode, message: string, id?: string) => void,
): string {
  if (block.links.length === 0) return renderMarkdown(parserView(block.raw), { references });

  // Swap each link for a placeholder so markdown cannot mangle the label, then splice anchors in.
  const mark = placeholderCharacter(block.raw);
  let text = "";
  let at = 0;
  const replacements = block.links.map((link, n): Replacement => {
    text += block.raw.slice(at, link.start) + `${mark}${n}${mark}`;
    at = link.end;
    const literal = escapeHtml(block.raw.slice(link.start, link.end));

    const resolution = resolve(store, ctx, link.id);
    if (!resolution.ok) {
      error(resolution.error.code, resolution.error.message, link.id);
      return { anchor: literal, text: literal, literal };
    }
    const { target } = resolution;
    out.links.push({ id: target.id, ...(target.local ? {} : { origin: target.origin }) });
    const words = escapeHtml(link.label ?? anchorText(target));
    const href = escapeHtml(pageUrl(target.origin, target.kind, target.id, target.page));
    return { anchor: `<a href="${href}">${words}</a>`, text: words, literal };
  });
  text += block.raw.slice(at);

  return splice(renderMarkdown(parserView(text), { references }), mark, replacements);
}

function splice(html: string, mark: string, replacements: Replacement[]): string {
  const token = new RegExp(`${mark}(\\d+)${mark}`, "g");
  let inAnchor = 0;
  let inCode = 0;
  const out = html.split(/(<[^>]*>)/).map((part) => {
    if (part.startsWith("<")) {
      const inner = part.replace(token, (_, n: string) => replacements[Number(n)]!.literal);
      if (/^<a[\s>]/i.test(part)) inAnchor++;
      else if (/^<\/a>/i.test(part)) inAnchor = Math.max(0, inAnchor - 1);
      else if (/^<code[\s>]/i.test(part)) inCode++;
      else if (/^<\/code>/i.test(part)) inCode = Math.max(0, inCode - 1);
      return inner;
    }
    return part.replace(token, (_, n: string) => {
      const replacement = replacements[Number(n)]!;
      return inCode ? replacement.literal : inAnchor ? replacement.text : replacement.anchor;
    });
  });
  // markdown-it percent-encodes a placeholder that lands inside a URL.
  const encoded = encodeURIComponent(mark);
  return out.join("").replace(new RegExp(`${encoded}(\\d+)${encoded}`, "g"), (_, n: string) => replacements[Number(n)]!.literal);
}

/**
 * What a link says when its author gave no label. Items are titleless (§5.3), so
 * an id would mean nothing: use the target's leading heading, else a short
 * quoted excerpt. The spec leaves this to the publisher; it is frozen into
 * `content_html` at publish like everything else rendered.
 */
function anchorText(target: Target): string {
  const heading = /^\s*<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(target.html);
  const title = heading ? excerpt(textContent(heading[1]!), 80) : "";
  if (title) return title;
  const words = excerpt(textContent(target.html).replace(/\n/g, " "), 60);
  return words ? `“${words}”` : target.kind === "thread" ? "a thread" : "a fragment";
}

function excerpt(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit ? text : characters.slice(0, limit).join("").trimEnd() + "…";
}
