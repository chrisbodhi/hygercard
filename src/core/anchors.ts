// PRESENTATION ONLY. Nothing here is protocol and nothing here decides whether a
// quote is valid: that is the publisher's substring check at publish (§10.2).
// This finds where a quote's source passage currently is, so a band can be drawn
// to it, and says what state the quote is in.

import { diff_match_patch as DiffMatchPatch } from "diff-match-patch";
import type { Store, StoredItem } from "./store";
import { textContent } from "./textContent";
import type { Selector, Transclusion } from "./types";

export type Anchor =
  /** The passage occurs once, or its context picks one occurrence. */
  | { kind: "exact"; start: number; end: number }
  /** It occurs more than once and the context cannot choose; `start`/`end` are the best guess. */
  | { kind: "ambiguous"; start: number; end: number; candidates: number }
  /** No exact match, but a close one (`score` is similarity, 0 to 1). */
  | { kind: "fuzzy"; start: number; end: number; score: number }
  | { kind: "orphaned" };

const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};
const commonSuffix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};

/** Find a selector's passage in a source's current text content. */
export function locate(text: string, selector: Selector): Anchor {
  const { exact, prefix = "", suffix = "" } = selector;
  if (exact === "") return { kind: "orphaned" };

  const starts: number[] = [];
  for (let at = text.indexOf(exact); at >= 0; at = text.indexOf(exact, at + 1)) starts.push(at);

  if (starts.length === 1) return { kind: "exact", start: starts[0]!, end: starts[0]! + exact.length };
  if (starts.length > 1) {
    // Let the recorded context choose between occurrences.
    const scored = starts.map((start) => ({
      start,
      score: commonSuffix(text.slice(0, start), prefix) + commonPrefix(text.slice(start + exact.length), suffix),
    }));
    const best = Math.max(...scored.map((s) => s.score));
    const winners = scored.filter((s) => s.score === best);
    const pick = winners[0]!;
    return best > 0 && winners.length === 1
      ? { kind: "exact", start: pick.start, end: pick.start + exact.length }
      : { kind: "ambiguous", start: pick.start, end: pick.start + exact.length, candidates: starts.length };
  }
  return fuzzy(text, selector);
}

/** Approximate match: find the passage's head and tail near where its context says it was. */
function fuzzy(text: string, { exact, prefix = "" }: Selector): Anchor {
  const matcher = new DiffMatchPatch();
  matcher.Match_Threshold = 0.4;
  matcher.Match_Distance = Math.max(1000, text.length);
  const width = Math.min(32, exact.length); // the matcher's pattern limit

  const head = exact.slice(0, width);
  const tail = exact.slice(exact.length - width);
  const hint = prefix && text.indexOf(prefix) >= 0 ? text.indexOf(prefix) + prefix.length : 0;

  const start = matcher.match_main(text, head, hint);
  if (start < 0) return { kind: "orphaned" };
  const tailAt = matcher.match_main(text, tail, start + exact.length - width);
  if (tailAt < 0) return { kind: "orphaned" };
  const end = tailAt + width;
  if (end <= start) return { kind: "orphaned" };

  const found = text.slice(start, end);
  const distance = matcher.diff_levenshtein(matcher.diff_main(exact, found));
  const score = 1 - distance / Math.max(exact.length, found.length);
  return score < 0.5 ? { kind: "orphaned" } : { kind: "fuzzy", start, end, score };
}

/** A band's state, from comparing a reference with what the store holds now. */
export type BandState =
  | "current"
  /** The store holds a newer version of the source. */
  | "stale"
  | "withdrawn"
  /** A partial selector is no longer an exact match in the current text. */
  | "drifted"
  /** The source is not in the store. */
  | "missing";

export interface BandReading {
  state: BandState;
  /** The source item as the store holds it now, if it does. */
  item?: StoredItem;
  /** Where a partial quote's passage is in the source's current text. */
  anchor?: Anchor;
}

/**
 * Compare a `transclusions[]` entry with the store. When more than one thing is
 * true the most serious wins: missing, withdrawn, drifted, stale, current.
 */
export function bandState(entry: Transclusion, store: Store, draftOrigin: string): BandReading {
  const item = store.get(entry.origin ?? draftOrigin, entry.id);
  if (!item || item.l0) return { state: "missing" };
  if (item.state === "withdrawn") return { state: "withdrawn", item };

  const anchor = entry.selector ? locate(textContent(item.doc.content_html), entry.selector) : undefined;
  const drifted = anchor !== undefined && (anchor.kind === "fuzzy" || anchor.kind === "orphaned");
  if (drifted) return { state: "drifted", item, anchor };
  return { state: item.doc.version > entry.version ? "stale" : "current", item, ...(anchor ? { anchor } : {}) };
}
