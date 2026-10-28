// Fixtures: what `bun run snapshot` captured, loaded into a store.
//
// Layout under fixtures/:
//   index.json                     what was captured, when, and every issue found
//   {slug}/blyg.json               the manifest
//   {slug}/items/index.json        the archive index
//   {slug}/items/{id}.json         item documents
//   {slug}/l0.json                 a legacy RSS source: { title, items: [...] }
//
// Reading is injected (`read`), so the same loader works under bun (fs) and in
// the browser (Vite's import.meta.glob).

import type { Store } from "../core/store";
import type { ItemDocument, Manifest } from "../core/types";
import type { CaptureIssue } from "./surface";

export interface FixtureSource {
  slug: string;
  /** The URL it was resolved from (§12.1). */
  input: string;
  /** Identity origin for a blyg, the feed URL for an L0 source. */
  origin: string;
  level: "blyg" | "l0";
  title: string;
  capturedAt: string;
  /** How many items the origin's index lists, and which were captured. */
  indexed: number;
  itemIds: string[];
  resolution: string[];
  issues: CaptureIssue[];
}

export interface FixtureIndex {
  capturedAt: string;
  specPin: string;
  limitItems: number;
  sources: FixtureSource[];
}

export type Reader = (path: string) => Promise<unknown>;

export async function loadFixtureIndex(read: Reader): Promise<FixtureIndex> {
  return (await read("index.json")) as FixtureIndex;
}

/** Load one captured source into the store. Returns the issues ingest found. */
export async function loadFixtureSource(store: Store, source: FixtureSource, read: Reader): Promise<CaptureIssue[]> {
  const issues: CaptureIssue[] = [];
  if (source.level === "l0") {
    const { title, items } = (await read(`${source.slug}/l0.json`)) as { title: string; items: ItemDocument[] };
    store.addSource({ origin: source.origin, level: "l0", title });
    for (const item of items) store.putL0(source.origin, item);
    return issues;
  }

  const manifest = (await read(`${source.slug}/blyg.json`)) as Manifest;
  store.addSource({ origin: source.origin, level: "blyg", title: manifest.title ?? source.title, manifest });
  // Read in parallel, ingest oldest first, so a newer version of anything wins by arriving later.
  const documents = await Promise.all([...source.itemIds].reverse().map((id) => read(`${source.slug}/items/${id}.json`)));
  store.batch(() => {
    for (const raw of documents) {
      for (const issue of store.ingest(source.origin, raw)) issues.push({ where: issue.where, code: issue.code, message: issue.message });
    }
  });
  return issues;
}

/** Load every source in the index. */
export async function loadFixtures(store: Store, read: Reader): Promise<{ index: FixtureIndex; issues: CaptureIssue[] }> {
  const index = await loadFixtureIndex(read);
  const loaded = await Promise.all(index.sources.map((source) => loadFixtureSource(store, source, read)));
  return { index, issues: loaded.flat() };
}
