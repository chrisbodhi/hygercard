// Spec shapes, pinned to SPEC_PIN.md. Only what this client reads or writes is
// typed strictly; everything else is preserved (§13.1 rule 4: unknown members
// are ignored, never rejected, and never dropped from a stored document).

/** Kinds this version defines (§5.3). Any other kind is an unknown construct. */
export type Kind = "fragment" | "thread" | "withdrawn";

/** The human half of a citation (§5.9). `retrieved` is REQUIRED whenever `cited` is present. */
export interface Cited {
  source?: string;
  author?: string;
  excerpt?: string;
  url?: string;
  retrieved: string;
}

/**
 * `{ origin, id, version }` (§5.9). `origin` is REQUIRED in `forked_from` and
 * `stub_of`, OPTIONAL in `transclusions[]` and `generated[].sources[]`, where
 * omission means the publisher's own origin.
 */
export interface Reference {
  origin?: string;
  id: string;
  version: number;
  cited?: Cited;
}

/** W3C text-quote selector (§10.3): `exact` is REQUIRED, context is optional and short. */
export interface Selector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

/** A `transclusions[]` entry (§10.3): a reference, plus a selector when the quote is partial. */
export interface Transclusion extends Reference {
  selector?: Selector;
}

/** A `links[]` entry (§10.3a): not a reference. No version, no `cited`, no selector. */
export interface LinkEntry {
  id: string;
  origin?: string;
}

/** `stub_of` (§10.6): a blyg target (a reference with REQUIRED origin) or a plain-web `{ url }`. Preserve only. */
export type StubOf = (Reference & { origin: string }) | { url: string; cited?: Cited };

/** One `generated[]` span (§5.7). Preserve only; this client never writes one. */
export interface Generated {
  sources?: Reference[];
  model?: string;
  at?: string;
}

export interface ChangelogEntry {
  version: number;
  at: string;
  note: string | null;
  pinned?: boolean;
  generated?: boolean;
}

export interface Media {
  url: string;
  mime: string;
  alt?: string;
}

/** `author` is opaque and client-asserted (§5.5): carried verbatim, never synthesized. */
export interface Author {
  name?: string;
  url?: string;
  [member: string]: unknown;
}

/** An item document, `items/{id}.json` (§5). */
export interface ItemDocument {
  blyg: string;
  id: string;
  kind: string;
  origin: string;
  version: number;
  created: string;
  updated: string;
  content_md: string;
  content_html: string;
  content_hash: string;
  changelog: ChangelogEntry[];
  media: Media[];
  page?: string;
  author?: Author;
  transclusions?: Transclusion[];
  stub_of?: StubOf;
  forked_from?: Reference & { origin: string };
  generated?: Generated[];
  links?: LinkEntry[];
}

/** The manifest, `blyg.json` (§6.1). REQUIRED: `blyg`, `title`, `updated`. */
export interface Manifest {
  blyg: string;
  title: string;
  updated: string;
  level?: number;
  generator?: string;
  generator_url?: string;
  site?: string;
  author?: { name?: string; [member: string]: unknown };
  feed?: string;
  items?: string;
  item?: string;
  pin?: string;
  blogroll?: string;
  webmention?: string;
}

export interface IndexEntry {
  id: string;
  kind: string;
  created: string;
  updated: string;
  version: number;
}

/** The archive index, `items/index.json` (§6.2). */
export interface ArchiveIndex {
  updated?: string;
  items: IndexEntry[];
}

/** What a reader records while importing anyway (§13.1, §13.3). */
export type IssueCode =
  | "not-an-object"
  | "missing-member"
  | "bad-member-type"
  | "malformed-id"
  | "unknown-kind"
  | "unexpected-spec-version"
  | "hash-mismatch"
  | "version-regression"
  | "stealth-edit"
  | "origin-mismatch"
  | "updated-mismatch"
  | "relative-url"
  | "bad-reference";

export interface Issue {
  code: IssueCode;
  /** Where it was found: `{origin} {id}` for an item, or a short path inside the document. */
  where: string;
  message: string;
}
