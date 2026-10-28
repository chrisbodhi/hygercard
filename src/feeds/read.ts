// Reading one source end to end: resolve the URL (§12), then the manifest's
// surface (§6): archive index, then item documents. Shared by the snapshot
// script, which writes what it reads to disk, and the live-data toggle, which
// puts it in the store.

import type { ItemDocument, Manifest } from "../core/types";
import type { Fetcher } from "./http";
import { wrapFeed } from "./l0";
import { resolveUrl } from "./resolveUrl";
import { fetchIndex, fetchItems, manifestIssues, surfaceOf, type CaptureIssue } from "./surface";

export type SourceRead =
  | { kind: "failed"; input: string; trail: string[] }
  | { kind: "l0"; input: string; feedUrl: string; title: string; items: ItemDocument[]; trail: string[] }
  | {
      kind: "blyg";
      input: string;
      origin: string;
      manifest: Manifest;
      /** How many items the origin's archive index lists. */
      indexed: number;
      /** The newest items fetched, newest first, exactly as the origin served them. */
      items: Array<{ id: string; raw: unknown }>;
      /** Problems with the manifest, the index and the fetching. Item-level checks are ingest's. */
      issues: CaptureIssue[];
      /** The raw archive index, when there was one. */
      index: unknown;
      trail: string[];
    };

export async function readSource(input: string, fetcher: Fetcher, limit: number): Promise<SourceRead> {
  const resolution = await resolveUrl(input, fetcher);
  if (resolution.kind === "failed") return { kind: "failed", input, trail: resolution.trail };

  if (resolution.kind === "l0") {
    const { title, items } = wrapFeed(resolution.feedUrl, resolution.feed, limit);
    return { kind: "l0", input, feedUrl: resolution.feedUrl, title, items, trail: resolution.trail };
  }

  const { origin, manifest, trail } = resolution;
  const surface = surfaceOf(origin, manifest);
  const issues = manifestIssues(origin, manifest);
  const { index, issues: indexIssues } = await fetchIndex(surface, fetcher);
  issues.push(...indexIssues);
  const fetched = index ? await fetchItems(surface, index, fetcher, limit) : { items: [], issues: [] };
  issues.push(...fetched.issues);
  return { kind: "blyg", input, origin, manifest, indexed: index?.items.length ?? 0, items: fetched.items, issues, index, trail };
}
