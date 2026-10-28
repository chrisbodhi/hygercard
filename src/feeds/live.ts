// The live-data toggle: read a source over the network and put it in the store.
// Reads only; nothing is written anywhere but the in-memory store.

import type { Store } from "../core/store";
import type { Fetcher } from "./http";
import { readSource } from "./read";
import type { CaptureIssue } from "./surface";

export interface LiveResult {
  /** One line for the person at the keyboard. */
  message: string;
  origin?: string;
  issues: CaptureIssue[];
}

export async function loadLive(store: Store, input: string, fetcher: Fetcher, limit: number): Promise<LiveResult> {
  const read = await readSource(input, fetcher, limit);
  if (read.kind === "failed") {
    return { message: `could not resolve ${input}: ${read.trail.join("; ")}`, issues: [] };
  }
  if (read.kind === "l0") {
    store.addSource({ origin: read.feedUrl, level: "l0", title: read.title });
    for (const item of read.items) store.putL0(read.feedUrl, item);
    return { message: `${read.title}: plain RSS (L0), ${read.items.length} entries, not quotable`, origin: read.feedUrl, issues: [] };
  }

  store.addSource({ origin: read.origin, level: "blyg", title: read.manifest.title ?? read.origin, manifest: read.manifest });
  const issues = [...read.issues];
  // Oldest first, so that a newer version of anything arrives later and wins.
  for (const { raw } of [...read.items].reverse()) {
    for (const issue of store.ingest(read.origin, raw)) issues.push({ where: issue.where, code: issue.code, message: issue.message });
  }
  return {
    message: `${read.manifest.title ?? read.origin}: ${read.items.length} of ${read.indexed} items, ${issues.length} issue(s)`,
    origin: read.origin,
    issues,
  };
}
