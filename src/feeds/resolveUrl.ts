// §12: from a URL found out-of-band to a subscription target. Deterministic,
// ordered, and bounded to at most 6 fetches. Redirects are bounded by the
// fetcher (5), and the final URL of the manifest fetch gives the identity origin (§12.2).

import { XMLParser } from "fast-xml-parser";
import { Parser } from "htmlparser2";
import type { Manifest } from "../core/types";
import type { Fetcher, FetchResult } from "./http";

export const FETCH_BUDGET = 6;

export type Resolution =
  /** A blyg. `origin` is the identity origin: the manifest's final URL minus its last segment. */
  | { kind: "blyg"; origin: string; manifestUrl: string; manifest: Manifest; trail: string[] }
  /** A legacy RSS feed (L0, §13.6). `feedUrl` is its identity. */
  | { kind: "l0"; feedUrl: string; feed: string; trail: string[] }
  | { kind: "failed"; trail: string[] };

const XML = new XMLParser({ ignoreAttributes: false, removeNSPrefix: false, parseTagValue: false, trimValues: true });

/** Whether a body is a manifest: a JSON object with a `"blyg"` version key (§12.1 step 2). Content-Type is not trusted. */
export function parseManifest(text: string): Manifest | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) && "blyg" in value ? (value as Manifest) : null;
  } catch {
    return null;
  }
}

/** The identity origin for a manifest fetched from `finalUrl`: that URL minus its last path segment (§12.2). */
export function identityOrigin(finalUrl: string): string {
  const url = new URL(finalUrl);
  url.search = "";
  url.hash = "";
  return new URL(".", url).href;
}

interface Feed {
  manifest: string | undefined;
}

/** Parse RSS or Atom; `null` when the body is not a feed. */
export function parseFeed(text: string): Feed | null {
  let tree: Record<string, unknown>;
  try {
    tree = XML.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rss = tree.rss as { channel?: Record<string, unknown> } | undefined;
  if (rss && typeof rss === "object") {
    const manifest = rss.channel?.["blyg:manifest"];
    return { manifest: typeof manifest === "string" ? manifest : undefined };
  }
  const atom = tree.feed as Record<string, unknown> | undefined;
  if (atom && typeof atom === "object") {
    const manifest = atom["blyg:manifest"];
    return { manifest: typeof manifest === "string" ? manifest : undefined };
  }
  return null;
}

/** The `<link>` elements of an HTML document. */
export function htmlLinks(html: string): Array<Record<string, string>> {
  const links: Array<Record<string, string>> = [];
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "link") links.push(attributes);
    },
  });
  parser.write(html);
  parser.end();
  return links;
}

export async function resolveUrl(input: string, fetcher: Fetcher, budget = FETCH_BUDGET): Promise<Resolution> {
  const trail: string[] = [];
  const probed = new Set<string>();
  let fetches = 0;

  /** One fetch against the budget. `null` when the budget is spent or there was no response. */
  const get = async (url: string): Promise<FetchResult | null> => {
    if (fetches >= budget) {
      trail.push(`${url}: fetch budget of ${budget} spent`);
      return null;
    }
    fetches++;
    probed.add(url);
    try {
      const result = await fetcher(url);
      trail.push(`${url}: ${result.status}${result.url !== url ? ` -> ${result.url}` : ""}`);
      return result;
    } catch (error) {
      trail.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const manifestFrom = (result: FetchResult | null): Resolution | null => {
    if (!result || result.status !== 200) return null;
    const manifest = parseManifest(result.text);
    return manifest ? { kind: "blyg", origin: identityOrigin(result.url), manifestUrl: result.url, manifest, trail } : null;
  };

  // 1. Normalize: strip query and fragment; the candidate origin ends in `/`.
  let candidate: URL;
  try {
    candidate = new URL(input);
  } catch {
    return { kind: "failed", trail: [`${input}: not a URL`] };
  }
  candidate.search = "";
  candidate.hash = "";
  if (!candidate.pathname.endsWith("/")) candidate.pathname += "/";

  // 2. Direct probe.
  const direct = manifestFrom(await get(new URL("blyg.json", candidate).href));
  if (direct) return direct;

  // 3. Feed upgrade: the input URL itself, if it is a feed. If it is HTML, step 4 reads the same response.
  const page = await get(input.split("#")[0]!);
  let l0: { feedUrl: string; feed: string } | null = null;
  let html: FetchResult | null = null;
  if (page && page.status === 200) {
    const feed = parseFeed(page.text);
    if (feed) {
      if (feed.manifest) {
        const upgraded = manifestFrom(await get(new URL(feed.manifest, page.url).href));
        if (upgraded) return upgraded;
      }
      l0 = { feedUrl: page.url, feed: page.text };
    } else {
      html = page;
    }
  }

  // 4. rel probe, one hop only.
  if (html) {
    const rel = htmlLinks(html.text).find((link) => link.rel?.split(/\s+/).includes("blyg") && link.href);
    if (rel) {
      const href = new URL(rel.href!, html.url).href;
      const result = await get(href);
      const asManifest = manifestFrom(result);
      if (asManifest) return asManifest;
      // Otherwise the href is an origin base URL: append blyg.json and probe as in step 2.
      const base = href.endsWith("/") ? href : href + "/";
      const probe = new URL("blyg.json", base).href;
      if (!probed.has(probe)) {
        const found = manifestFrom(await get(probe));
        if (found) return found;
      }
    }
  }

  // 5. Conventional-mount probes at the scheme+host root.
  const root = new URL(input);
  for (const path of ["/blyg/blyg.json", "/blyg.json"]) {
    const probe = new URL(path, root.origin).href;
    if (probed.has(probe)) continue;
    const found = manifestFrom(await get(probe));
    if (found) return found;
  }

  // 6. RSS fallback: the L0 candidate, or standard autodiscovery on the input's HTML.
  if (l0) return { kind: "l0", ...l0, trail };
  if (html) {
    const alternate = htmlLinks(html.text).find(
      (link) =>
        link.rel?.split(/\s+/).includes("alternate") &&
        /^application\/(rss|atom)\+xml$/i.test(link.type ?? "") &&
        link.href,
    );
    if (alternate) {
      const feedResult = await get(new URL(alternate.href!, html.url).href);
      if (feedResult && feedResult.status === 200 && parseFeed(feedResult.text)) {
        return { kind: "l0", feedUrl: feedResult.url, feed: feedResult.text, trail };
      }
    }
  }
  return { kind: "failed", trail };
}
