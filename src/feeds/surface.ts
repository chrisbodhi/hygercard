// Reading a blyg's publication surface (§4, §6): the manifest says where things
// live, the archive index lists every item, and item documents are the ground
// truth. The feed is not read: the state plane is the content source (§1).

import { isValidId } from "../core/ids";
import type { ArchiveIndex, IndexEntry, Manifest } from "../core/types";
import type { Fetcher } from "./http";

/** A problem met while reading; the read goes on. */
export interface CaptureIssue {
  where: string;
  code: string;
  message: string;
}

/** RFC 6570 level 1: `{name}` is replaced by the percent-encoded value; unknown names are left as written. */
export function expandTemplate(template: string, variables: Record<string, string | number>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const value = variables[name];
    if (value === undefined) return whole;
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  });
}

export interface Surface {
  origin: string;
  manifest: Manifest;
  feedUrl: string;
  indexUrl: string;
  itemUrl(id: string): string;
  pinUrl(id: string, version: number): string;
}

/** Where an origin serves things: the manifest's `feed`, `items`, `item` and `pin`, else the defaults (§6.1). */
export function surfaceOf(origin: string, manifest: Manifest): Surface {
  const at = (path: string) => new URL(path, origin).href;
  return {
    origin,
    manifest,
    feedUrl: at(manifest.feed ?? "feed.xml"),
    indexUrl: at(manifest.items ?? "items/index.json"),
    itemUrl: (id) => at(expandTemplate(manifest.item ?? "items/{id}.json", { id })),
    pinUrl: (id, version) => at(expandTemplate(manifest.pin ?? "items/{id}/v{n}.json", { id, n: version })),
  };
}

/** The manifest's REQUIRED members are `blyg`, `title` and `updated` (§6.1). */
export function manifestIssues(origin: string, manifest: Manifest): CaptureIssue[] {
  const issues: CaptureIssue[] = [];
  for (const member of ["blyg", "title", "updated"] as const) {
    if (typeof manifest[member] !== "string") {
      issues.push({ where: `${origin}blyg.json`, code: "manifest-member", message: `manifest is missing REQUIRED \`${member}\`` });
    }
  }
  if (typeof manifest.site === "string" && new URL(manifest.site, origin).href !== origin) {
    issues.push({
      where: `${origin}blyg.json`,
      code: "site-mismatch",
      message: `manifest \`site\` ${manifest.site} disagrees with the identity origin ${origin}; the origin wins (§12.2)`,
    });
  }
  return issues;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Fetch and lightly check the archive index (§6.2). Entries are returned newest first, whatever order they came in. */
export async function fetchIndex(
  surface: Surface,
  fetcher: Fetcher,
): Promise<{ index: ArchiveIndex | null; issues: CaptureIssue[] }> {
  const where = surface.indexUrl;
  try {
    const response = await fetcher(surface.indexUrl);
    if (response.status !== 200) {
      return { index: null, issues: [{ where, code: "index-status", message: `archive index returned ${response.status} (§13.2: a nonconforming publisher)` }] };
    }
    const value = parseJson(response.text) as { items?: unknown } | undefined;
    if (!value || !Array.isArray(value.items)) {
      return { index: null, issues: [{ where, code: "index-shape", message: "archive index is not { items: [...] }" }] };
    }
    const issues: CaptureIssue[] = [];
    const entries = (value.items as unknown[]).filter((entry): entry is IndexEntry => {
      const ok = typeof entry === "object" && entry !== null && isValidId((entry as IndexEntry).id);
      if (!ok) issues.push({ where, code: "index-entry", message: `skipped an index entry without a valid id: ${JSON.stringify(entry)?.slice(0, 80)}` });
      return ok;
    });
    entries.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    return { index: { ...(value as ArchiveIndex), items: entries }, issues };
  } catch (error) {
    return { index: null, issues: [{ where, code: "fetch-failed", message: error instanceof Error ? error.message : String(error) }] };
  }
}

/** Fetch one item document. Returns the parsed JSON, or why there is none. */
export async function fetchItem(
  surface: Surface,
  id: string,
  fetcher: Fetcher,
): Promise<{ raw: unknown | undefined; issues: CaptureIssue[] }> {
  const where = surface.itemUrl(id);
  try {
    const response = await fetcher(where);
    if (response.status !== 200) {
      return { raw: undefined, issues: [{ where, code: "item-status", message: `item document returned ${response.status}` }] };
    }
    const raw = parseJson(response.text);
    if (raw === undefined) return { raw: undefined, issues: [{ where, code: "item-json", message: "item document is not valid JSON" }] };
    return { raw, issues: [] };
  } catch (error) {
    return { raw: undefined, issues: [{ where, code: "fetch-failed", message: error instanceof Error ? error.message : String(error) }] };
  }
}

/** Fetch up to `limit` of an index's newest items, a few at a time. */
export async function fetchItems(
  surface: Surface,
  index: ArchiveIndex,
  fetcher: Fetcher,
  limit: number,
  concurrency = 4,
): Promise<{ items: Array<{ id: string; raw: unknown }>; issues: CaptureIssue[] }> {
  const wanted = index.items.slice(0, limit);
  const results = new Array<{ id: string; raw: unknown } | undefined>(wanted.length);
  const issues: CaptureIssue[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, wanted.length) }, async () => {
      while (next < wanted.length) {
        const at = next++;
        const entry = wanted[at]!;
        const { raw, issues: found } = await fetchItem(surface, entry.id, fetcher);
        issues.push(...found);
        if (raw !== undefined) results[at] = { id: entry.id, raw };
      }
    }),
  );
  return { items: results.filter((item): item is { id: string; raw: unknown } => item !== undefined), issues };
}
