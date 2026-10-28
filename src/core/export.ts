// A draft as a complete thread item document (§5), the file a publisher would
// serve at items/{id}.json. Nothing is published or sent anywhere.

import { bake, type BakeError, type BakeResult } from "./bake";
import { contentHash } from "./hash";
import { pageUrl } from "./html";
import { newId } from "./ids";
import type { Store } from "./store";
import type { Cited, ItemDocument, Transclusion } from "./types";

/** The placeholder origin a draft is exported under until it has a real one. */
export const DEFAULT_ORIGIN = "http://localhost:5173/blyg/";

export interface DraftMeta {
  id: string;
  /** ISO 8601 UTC. The draft is exported as version 1, published at this instant. */
  created: string;
  /** The draft's origin. It differs from every imported origin, so every reference carries `origin`. */
  origin: string;
}

export function newDraftMeta(now = new Date(), origin = DEFAULT_ORIGIN): DraftMeta {
  return { id: newId(), created: now.toISOString().replace(/\.\d+Z$/, "Z"), origin };
}

export type Exported =
  | { ok: true; doc: ItemDocument; bake: BakeResult }
  /** A draft with publish errors is not a publishable document. */
  | { ok: false; errors: BakeError[]; bake: BakeResult };

/**
 * `cited` is OPTIONAL (§5.9). It is written here, with `retrieved` set to the
 * publish instant, because a reader whose target has since disappeared would
 * otherwise hold an identity and nothing to show. It never carries an excerpt:
 * verbatim quotation is transclusion alone, and a caption could become a second
 * channel for it.
 */
function citedFor(entry: Transclusion, store: Store, meta: DraftMeta): Cited | undefined {
  const origin = entry.origin ?? meta.origin;
  const item = store.get(origin, entry.id);
  if (!item) return undefined;
  const source = store.source(origin)?.title;
  const author = item.doc.author?.name;
  return {
    ...(source ? { source } : {}),
    ...(typeof author === "string" && author ? { author } : {}),
    url: pageUrl(origin, item.doc.kind, item.doc.id, item.doc.page),
    retrieved: meta.created,
  };
}

export function exportDocument(contentMd: string, meta: DraftMeta, store: Store): Exported {
  const result = bake(contentMd, store, { origin: meta.origin, draftId: meta.id });
  if (result.errors.length > 0) return { ok: false, errors: result.errors, bake: result };

  const transclusions = result.transclusions.map((entry): Transclusion => {
    const cited = citedFor(entry, store, meta);
    return cited ? { ...entry, cited } : entry;
  });

  const doc: ItemDocument = {
    blyg: "0.4",
    id: meta.id,
    kind: "thread",
    origin: meta.origin,
    page: `t/${meta.id}/`,
    created: meta.created,
    updated: meta.created,
    version: 1,
    content_md: contentMd,
    content_html: result.html,
    content_hash: contentHash(contentMd),
    media: [],
    changelog: [{ version: 1, at: meta.created, note: null }],
    transclusions,
    ...(result.links.length > 0 ? { links: result.links } : {}),
  };
  return { ok: true, doc, bake: result };
}
