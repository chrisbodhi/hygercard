// Conformance checks of this client's core against real publishers' documents.
// Used by the fixture tests and by scripts/findings.ts, which prints the report
// the README quotes. A failure here is either a bug in core or a publisher's,
// and the report says which documents to look at.

import { bake } from "../core/bake";
import { parse, serialize } from "../core/grammar";
import type { Store, StoredItem } from "../core/store";
import { textContent } from "../core/textContent";
import type { Selector, Transclusion } from "../core/types";
import type { FixtureIndex } from "./fixtures";

/** Every current blyg item (not L0) in the store. */
export function allItems(store: Store, index: FixtureIndex): StoredItem[] {
  return index.sources.filter((s) => s.level === "blyg").flatMap((s) => store.items(s.origin));
}

/** serialize(parse(md)) === md for every item's content_md. */
export function grammarRoundTrip(items: StoredItem[]): { checked: number; failures: string[] } {
  const failures = items.filter((row) => serialize(parse(row.doc.content_md)) !== row.doc.content_md).map((row) => `${row.origin} ${row.id}`);
  return { checked: items.length, failures };
}

export type SelectorResult = "ok" | "failed" | "target-absent" | "version-moved";

export interface SelectorCheck {
  thread: string;
  origin: string;
  target: string;
  targetOrigin: string;
  version: number;
  exact: string;
  result: SelectorResult;
}

/**
 * For every thread whose `content_html` contains `blyg-partial` and whose
 * `transclusions[]` entry has a `selector`: when the target is in the store at
 * the referenced version, `selector.exact` must be a substring of the target's
 * text content (§10.2). A target that is absent, or has moved to another
 * version, cannot be checked, and is counted so the gap is visible.
 */
export function checkSelectors(store: Store, items: StoredItem[]): SelectorCheck[] {
  const checks: SelectorCheck[] = [];
  for (const row of items) {
    const { doc } = row;
    if (doc.kind !== "thread" || !doc.content_html.includes("blyg-partial")) continue;
    for (const entry of doc.transclusions ?? []) {
      if (!entry.selector) continue;
      const targetOrigin = entry.origin ?? row.origin;
      const target = store.get(targetOrigin, entry.id);
      const base = { thread: doc.id, origin: row.origin, target: entry.id, targetOrigin, version: entry.version, exact: entry.selector.exact };
      if (!target || target.state !== "current") checks.push({ ...base, result: "target-absent" });
      else if (target.doc.version !== entry.version) checks.push({ ...base, result: "version-moved" });
      else checks.push({ ...base, result: textContent(target.doc.content_html).includes(entry.selector.exact) ? "ok" : "failed" });
    }
  }
  return checks;
}

export interface RebakeCheck {
  origin: string;
  thread: string;
  /** Why this thread cannot be compared, or `null` when it can. */
  skipped: "generated" | "errors" | "other-targets" | null;
  htmlEqual: boolean;
  /** Equal once the label attribute, which the reference implementation does not bake, is removed. */
  htmlEqualWithoutLabels: boolean;
  transclusionsEqual: boolean;
  firstDifference?: { mine: string; theirs: string };
}

const withoutLabels = (html: string) => html.replace(/ data-blyg-label="[^"]*"/g, "");
const sameSelector = (a?: Selector, b?: Selector) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sameEntries = (a: Transclusion[], b: Transclusion[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i]!.id && x.version === b[i]!.version && x.origin === b[i]!.origin && sameSelector(x.selector, b[i]!.selector));

/**
 * Bake a published thread's `content_md` again, against the snapshots in the
 * store, and compare with what its publisher published. Only meaningful for
 * threads published by the reference implementation, whose bytes are the ones
 * core reproduces; and only when the store holds the same target versions the
 * thread baked.
 */
export function rebake(store: Store, row: StoredItem): RebakeCheck {
  const { doc } = row;
  const base = { origin: row.origin, thread: doc.id, htmlEqual: false, htmlEqualWithoutLabels: false, transclusionsEqual: false };
  if ((doc.generated?.length ?? 0) > 0 || doc.content_html.includes("blyg-tk-gen")) return { ...base, skipped: "generated" };

  const result = bake(doc.content_md, store, { origin: row.origin, draftId: doc.id });
  if (result.errors.length > 0) return { ...base, skipped: "errors" };
  if (!sameEntries(result.transclusions, doc.transclusions ?? [])) return { ...base, skipped: "other-targets" };

  const mine = result.html;
  const theirs = doc.content_html;
  let at = 0;
  while (at < mine.length && mine[at] === theirs[at]) at++;
  const equal = mine === theirs;
  return {
    ...base,
    skipped: null,
    htmlEqual: equal,
    htmlEqualWithoutLabels: equal || withoutLabels(mine) === theirs,
    transclusionsEqual: JSON.stringify(result.transclusions.map(strip)) === JSON.stringify((doc.transclusions ?? []).map(strip)),
    ...(equal ? {} : { firstDifference: { mine: mine.slice(Math.max(0, at - 30), at + 60), theirs: theirs.slice(Math.max(0, at - 30), at + 60) } }),
  };
}

/** A reference without its `cited`, which a baker does not reproduce. */
function strip({ cited: _cited, ...rest }: Transclusion) {
  return rest;
}

/** Wrapper shapes seen in the wild: how publishers differ in the bytes §10.2 leaves open. */
export function wrapperShapes(items: StoredItem[]): { total: number; newlineAfterOpen: number; noNewline: number; originBeforeVersion: number; labelled: number } {
  const counts = { total: 0, newlineAfterOpen: 0, noNewline: 0, originBeforeVersion: 0, labelled: 0 };
  for (const row of items) {
    for (const m of row.doc.content_html.matchAll(/<blockquote class="blyg-transclusion[^"]*"([^>]*)>(\n?)/g)) {
      counts.total++;
      if (m[2] === "\n") counts.newlineAfterOpen++;
      else counts.noNewline++;
      if (/data-blyg-origin="[^"]*" data-blyg-version=/.test(m[1]!)) counts.originBeforeVersion++;
      if (m[1]!.includes("data-blyg-label")) counts.labelled++;
    }
  }
  return counts;
}
