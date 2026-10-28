// The local snapshot store: imported item documents keyed by (origin, id).
// Everything a reader learns is scoped to the origin it was learned from
// (§13.1 rule 7). Documents are kept verbatim; sanitizing is the renderer's job
// (§14: store verbatim, sanitize at render).
//
// Ingest is lenient (§13.1 rule 4, §13.3): unknown members and kinds are
// ignored, and anything wrong with a document is recorded as an issue while the
// document is imported anyway.

import { contentHash } from "./hash";
import { relativeUrls } from "./html";
import { isValidId } from "./ids";
import type { ItemDocument, Issue, IssueCode, Manifest } from "./types";

const KNOWN_KINDS = new Set(["fragment", "thread", "withdrawn"]);

export interface StoredItem {
  /** The identity origin this item was learned from (§12.2). */
  origin: string;
  id: string;
  /** A plain-RSS wrapper row (§13.6): never a transclusion target (§10.2). */
  l0: boolean;
  /** `withdrawn` once the origin published an endcap (§13.4). */
  state: "current" | "withdrawn";
  /** The latest document as fetched; for a withdrawn item, the endcap. */
  doc: ItemDocument;
  /** A pin-retained snapshot of a withdrawn item: the pinned version's document (§13.4). */
  retained?: ItemDocument;
}

export interface Source {
  origin: string;
  /** `blyg` for a resolved manifest, `l0` for a legacy RSS feed (§12). */
  level: "blyg" | "l0";
  title: string;
  manifest?: Manifest;
}

const keyOf = (origin: string, id: string) => `${origin} ${id}`;

// --- Reading a document -----------------------------------------------------

const REQUIRED_STRINGS = ["blyg", "id", "kind", "origin", "created", "updated", "content_md", "content_html", "content_hash"] as const;

/** Check a fetched item document against §5 and import it anyway. Never throws, never mutates `raw`. */
export function readItemDocument(
  fetchOrigin: string,
  raw: unknown,
): { doc: ItemDocument | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const note = (code: IssueCode, where: string, message: string) => issues.push({ code, where, message });

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    note("not-an-object", fetchOrigin, "an item document must be a JSON object");
    return { doc: null, issues };
  }
  const doc = raw as Record<string, unknown>;
  const where = `${fetchOrigin} ${typeof doc.id === "string" ? doc.id : "?"}`;

  for (const member of REQUIRED_STRINGS) {
    if (doc[member] === undefined) note("missing-member", where, `missing REQUIRED member \`${member}\``);
    else if (typeof doc[member] !== "string") note("bad-member-type", where, `\`${member}\` must be a string`);
  }
  if (doc.version === undefined) note("missing-member", where, "missing REQUIRED member `version`");
  else if (!Number.isInteger(doc.version) || (doc.version as number) < 1) note("bad-member-type", where, "`version` must be a positive integer");
  for (const member of ["changelog", "media"] as const) {
    if (doc[member] === undefined) note("missing-member", where, `missing REQUIRED member \`${member}\``);
    else if (!Array.isArray(doc[member])) note("bad-member-type", where, `\`${member}\` must be an array`);
  }

  // Without an id there is nothing to key the item by; without a known kind there is nothing to do with it.
  if (typeof doc.id !== "string") return { doc: null, issues };
  if (!isValidId(doc.id)) note("malformed-id", where, `\`id\` ${JSON.stringify(doc.id)} is not 26 characters of Crockford base32`);
  if (typeof doc.kind !== "string" || !KNOWN_KINDS.has(doc.kind)) {
    note("unknown-kind", where, `unknown kind ${JSON.stringify(doc.kind)}: ignored (§5.3)`);
    return { doc: null, issues };
  }

  if (typeof doc.blyg === "string" && !/^0\./.test(doc.blyg)) {
    note("unexpected-spec-version", where, `\`blyg\` is ${JSON.stringify(doc.blyg)}; readers accept any 0.x (§3.1)`);
  }
  if (typeof doc.origin === "string" && doc.origin !== fetchOrigin) {
    note("origin-mismatch", where, `document says origin ${doc.origin}; it was fetched from ${fetchOrigin}, which is what counts (§12.2)`);
  }
  if (typeof doc.content_md === "string" && typeof doc.content_hash === "string") {
    const actual = contentHash(doc.content_md);
    if (actual !== doc.content_hash) note("hash-mismatch", where, `content_hash ${doc.content_hash} but content_md hashes to ${actual} (§13.3)`);
  }
  if (Array.isArray(doc.changelog) && doc.changelog.length > 0 && typeof doc.updated === "string") {
    const last = doc.changelog[doc.changelog.length - 1] as { at?: unknown } | null;
    if (last && last.at !== doc.updated) note("updated-mismatch", where, "`updated` must equal the latest changelog entry's `at` (§5.2)");
  }
  if (typeof doc.content_html === "string") {
    const relative = relativeUrls(doc.content_html);
    if (relative.length > 0) {
      note("relative-url", where, `content_html has ${relative.length} relative URL(s), e.g. ${JSON.stringify(relative[0])} (§5.2)`);
    }
  }

  if (doc.kind === "thread" && doc.transclusions === undefined) {
    note("missing-member", where, "a thread REQUIRES `transclusions` (§10.3)");
  }
  checkReferences(doc, where, note);

  return { doc: raw as ItemDocument, issues };
}

function checkReferences(doc: Record<string, unknown>, where: string, note: (code: IssueCode, where: string, message: string) => void) {
  const checkId = (id: unknown, path: string) => {
    if (typeof id !== "string") note("bad-reference", where, `${path}: \`id\` must be a string`);
    else if (!isValidId(id)) note("malformed-id", where, `${path}: ${JSON.stringify(id)} is not a well-formed id`);
  };
  const checkReference = (entry: unknown, path: string) => {
    if (typeof entry !== "object" || entry === null) return note("bad-reference", where, `${path}: must be an object`);
    const ref = entry as Record<string, unknown>;
    checkId(ref.id, path);
    if (!Number.isInteger(ref.version) || (ref.version as number) < 1) note("bad-reference", where, `${path}: \`version\` must be a positive integer`);
    if (ref.origin !== undefined && typeof ref.origin !== "string") note("bad-reference", where, `${path}: \`origin\` must be a string`);
    if (typeof ref.cited === "object" && ref.cited !== null && typeof (ref.cited as { retrieved?: unknown }).retrieved !== "string") {
      note("bad-reference", where, `${path}: \`cited\` REQUIRES \`retrieved\` (§5.9)`);
    }
    const selector = ref.selector as { exact?: unknown } | undefined;
    if (selector !== undefined && (typeof selector !== "object" || selector === null || typeof selector.exact !== "string")) {
      note("bad-reference", where, `${path}: a selector REQUIRES \`exact\` (§10.3)`);
    }
  };

  if (Array.isArray(doc.transclusions)) doc.transclusions.forEach((entry, i) => checkReference(entry, `transclusions[${i}]`));
  else if (doc.transclusions !== undefined) note("bad-member-type", where, "`transclusions` must be an array");
  if (Array.isArray(doc.links)) {
    doc.links.forEach((entry, i) => checkId((entry as { id?: unknown } | null)?.id, `links[${i}]`));
  }
  if (doc.forked_from !== undefined) checkReference(doc.forked_from, "forked_from");
  const stub = doc.stub_of as { id?: unknown } | undefined;
  if (stub && typeof stub === "object" && stub.id !== undefined) checkReference(stub, "stub_of");
}

// --- The store --------------------------------------------------------------

export class Store {
  private rows = new Map<string, StoredItem>();
  /** The highest version ever observed per item. It survives withdrawal (§13.4). */
  private watermarks = new Map<string, number>();
  private known = new Map<string, Source>();
  private listeners = new Set<() => void>();
  private changes = 0;

  /** Bumps on every change, for `useSyncExternalStore`. */
  get revision(): number {
    return this.changes;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed() {
    this.changes++;
    for (const listener of this.listeners) listener();
  }

  // Sources

  addSource(source: Source) {
    this.known.set(source.origin, source);
    this.changed();
  }

  sources(): Source[] {
    return [...this.known.values()];
  }

  source(origin: string): Source | undefined {
    return this.known.get(origin);
  }

  // Items

  /**
   * Import one fetched item document from `origin`. Returns the issues found;
   * the document is imported anyway unless it is unusable (no id, or an
   * unknown kind), or is a version regression, which §13.3 says never to adopt silently.
   */
  ingest(origin: string, raw: unknown): Issue[] {
    const { doc, issues } = readItemDocument(origin, raw);
    if (!doc) return issues;

    const key = keyOf(origin, doc.id);
    const watermark = this.watermarks.get(key) ?? 0;
    const version = Number.isInteger(doc.version) ? doc.version : 0;
    const where = `${origin} ${doc.id}`;

    if (version < watermark) {
      issues.push({ code: "version-regression", where, message: `version ${version} is below the watermark ${watermark}: not adopted (§13.3)` });
      return issues;
    }
    const held = this.rows.get(key);
    if (held && version === watermark && held.doc.content_hash !== doc.content_hash) {
      issues.push({ code: "stealth-edit", where, message: `version ${version} changed content without a version bump: adopted, recorded (§13.3)` });
    }

    this.watermarks.set(key, Math.max(watermark, version));
    const withdrawn = doc.kind === "withdrawn";
    this.rows.set(key, {
      origin,
      id: doc.id,
      l0: false,
      state: withdrawn ? "withdrawn" : "current",
      doc,
      // Retention follows the origin's pins and only outlives a withdrawal (§13.4).
      ...(withdrawn && held?.retained ? { retained: held.retained } : {}),
    });
    this.changed();
    return issues;
  }

  /**
   * Keep a pinned version's snapshot of an item the origin has withdrawn (§13.4).
   * The pinned file is what the origin still serves, so it is what may be quoted.
   */
  retain(origin: string, raw: unknown): Issue[] {
    const { doc, issues } = readItemDocument(origin, raw);
    if (!doc) return issues;
    const held = this.rows.get(keyOf(origin, doc.id));
    if (held?.state === "withdrawn" && doc.kind !== "withdrawn") {
      this.rows.set(keyOf(origin, doc.id), { ...held, retained: doc });
      this.changed();
    }
    return issues;
  }

  /** Store a plain-RSS entry as an L0 row (§13.6). Its id is synthetic and never a valid blyg id. */
  putL0(origin: string, doc: ItemDocument) {
    this.rows.set(keyOf(origin, doc.id), { origin, id: doc.id, l0: true, state: "current", doc });
    this.changed();
  }

  get(origin: string, id: string): StoredItem | undefined {
    return this.rows.get(keyOf(origin, id));
  }

  /** Every row with this id, across origins. Resolution needs all of them (§10.2). */
  byId(id: string): StoredItem[] {
    return [...this.rows.values()].filter((row) => row.id === id);
  }

  /** An origin's live items, newest first. */
  items(origin: string): StoredItem[] {
    return [...this.rows.values()]
      .filter((row) => row.origin === origin && row.state === "current")
      .sort((a, b) => b.doc.updated.localeCompare(a.doc.updated));
  }

  watermark(origin: string, id: string): number {
    return this.watermarks.get(keyOf(origin, id)) ?? 0;
  }

  clear() {
    this.rows.clear();
    this.watermarks.clear();
    this.known.clear();
    this.changed();
  }
}
