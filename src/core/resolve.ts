// Directive resolution, in §10.2's order. The snapshot is what gets baked;
// nothing here (or anywhere in core) fetches.
//
//   1. a local, currently-published item with that id (fragment or thread);
//   2. otherwise an imported blyg item with that id, current or withdrawn with a
//      pin-retained snapshot, and never an L0 wrapper;
//   3. otherwise a publish error: a draft, an unknown id, a withdrawn item with
//      nothing retained, an L0 row, or more than one imported match.
//
// A local id (a draft or a published item) never falls through to step 2: an
// imported document with the same id is §5.1's ambiguity, and naming it is a
// publish error (decision #76).

import type { Store } from "./store";
import type { ItemDocument } from "./types";

export interface ResolveContext {
  /** The publishing draft's origin. Items stored under it are local. */
  origin: string;
  /** The draft's own id. A thread cannot quote itself. */
  draftId: string;
  /** Other local ids that are drafts, never published. */
  otherDraftIds?: ReadonlySet<string>;
}

export interface Target {
  origin: string;
  id: string;
  version: number;
  kind: "fragment" | "thread";
  /** The snapshot's `content_html`, as stored (not yet absolutized or sanitized). */
  html: string;
  /** True when the item belongs to the publishing origin (no `data-blyg-origin` is baked). */
  local: boolean;
  /** True when this is a pin-retained snapshot of a withdrawn item. */
  retained: boolean;
  page: string | undefined;
}

export type ResolveErrorCode = "self" | "draft" | "unknown" | "withdrawn" | "l0" | "ambiguous" | "cycle";

export interface ResolveError {
  code: ResolveErrorCode;
  message: string;
}

export type Resolution = { ok: true; target: Target } | { ok: false; error: ResolveError };

const fail = (code: ResolveErrorCode, message: string): Resolution => ({ ok: false, error: { code, message } });

function targetOf(origin: string, doc: ItemDocument, local: boolean, retained: boolean): Target {
  return {
    origin,
    id: doc.id,
    version: doc.version,
    kind: doc.kind === "thread" ? "thread" : "fragment",
    html: doc.content_html,
    local,
    retained,
    page: doc.page,
  };
}

export function resolve(store: Store, ctx: ResolveContext, id: string): Resolution {
  if (id === ctx.draftId) return fail("self", "a thread cannot transclude itself");

  const rows = store.byId(id);
  const local = rows.filter((row) => row.origin === ctx.origin);
  const imported = rows.filter((row) => row.origin !== ctx.origin);

  // Step 1. A local id never falls through to step 2.
  if (local.length > 0 || ctx.otherDraftIds?.has(id)) {
    if (imported.length > 0) {
      return fail("ambiguous", "ambiguous id: an imported item has the same id as a local one (§5.1)");
    }
    const row = local[0];
    if (!row) return fail("draft", "item is a draft, not published");
    if (row.state === "withdrawn") return fail("withdrawn", "item is withdrawn");
    if (row.doc.kind === "thread" && closureReaches(store, ctx, row.doc, ctx.draftId)) {
      return fail("cycle", "circular transclusion: that thread already quotes this one");
    }
    return { ok: true, target: targetOf(row.origin, row.doc, true, false) };
  }

  // Step 2. Imported blyg items only.
  const blyg = imported.filter((row) => !row.l0);
  const usable = blyg.filter((row) => row.state === "current" || row.retained);
  if (usable.length > 1) {
    const origins = usable.map((row) => row.origin).join(", ");
    return fail("ambiguous", `ambiguous id: imported from more than one origin (${origins})`);
  }
  const only = usable[0];
  if (only) {
    // A withdrawn item's retained bytes are the pinned version's, so that is the provenance (§13.4).
    return only.state === "withdrawn"
      ? { ok: true, target: targetOf(only.origin, only.retained!, false, true) }
      : { ok: true, target: targetOf(only.origin, only.doc, false, false) };
  }

  // Step 3.
  if (blyg.length > 0) return fail("withdrawn", "source withdrawn by its origin, with nothing retained");
  if (imported.length > 0) return fail("l0", "source is a plain RSS (L0) item, not a blyg item");
  return fail("unknown", "unknown item");
}

/**
 * Does `thread`'s transitive local transclusion closure contain `needle`?
 * Only local entries are walked; remote closures are harmless snapshots and
 * unknowable (§10.2). The store holds one version per item, so this walks the
 * current document's `transclusions[]`, where the spec walks the versions
 * actually baked: a simplification noted in the README.
 */
function closureReaches(store: Store, ctx: ResolveContext, thread: ItemDocument, needle: string): boolean {
  const seen = new Set<string>();
  const queue = [thread];
  while (queue.length > 0) {
    const doc = queue.shift()!;
    for (const entry of doc.transclusions ?? []) {
      if (entry.origin !== undefined && entry.origin !== ctx.origin) continue;
      if (entry.id === needle) return true;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const next = store.get(ctx.origin, entry.id);
      if (next && next.doc.kind === "thread") queue.push(next.doc);
    }
  }
  return false;
}
