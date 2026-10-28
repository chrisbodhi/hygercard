// Helpers for tests: valid item documents without a network.

import { contentHash } from "./hash";
import { encodeId } from "./ids";
import { renderMarkdown } from "./markdown";
import { Store } from "./store";
import type { ItemDocument, Transclusion } from "./types";

/** A deterministic, valid id for `n`. */
export function id(n: number): string {
  const bytes = new Uint8Array(16);
  bytes[15] = n & 255;
  bytes[14] = n >> 8;
  return encodeId(bytes);
}

export const DRAFT_ORIGIN = "http://localhost:5173/blyg/";
export const REMOTE = "https://remote.test/blyg/";
export const OTHER = "https://other.test/";

interface ItemOptions {
  origin?: string;
  version?: number;
  kind?: "fragment" | "thread" | "withdrawn";
  md?: string;
  /** Defaults to the markdown rendered, which is what a real publisher writes. */
  html?: string;
  page?: string;
  transclusions?: Transclusion[];
  updated?: string;
}

export function item(itemId: string, options: ItemOptions = {}): ItemDocument {
  const { origin = REMOTE, version = 1, kind = "fragment", md = "Some words.", page, transclusions, updated = "2026-10-01T00:00:00Z" } = options;
  const withdrawn = kind === "withdrawn";
  const contentMd = withdrawn ? "" : md;
  return {
    blyg: "0.4",
    id: itemId,
    kind,
    origin,
    ...(page ? { page } : {}),
    created: "2026-10-01T00:00:00Z",
    updated,
    version,
    content_md: contentMd,
    content_html: withdrawn ? "" : (options.html ?? renderMarkdown(contentMd)),
    content_hash: contentHash(contentMd),
    media: [],
    changelog: [{ version, at: updated, note: null }],
    ...(kind === "thread" || transclusions ? { transclusions: transclusions ?? [] } : {}),
  };
}

/** A store holding the given documents, each under its own `origin`. */
export function storeOf(...docs: ItemDocument[]): Store {
  const store = new Store();
  for (const doc of docs) store.ingest(doc.origin, doc);
  return store;
}
