import { describe, expect, it } from "vitest";
import { isValidId } from "../core/ids";
import { FetchError, politeFetcher, type Fetcher, type FetchResult } from "./http";
import { wrapFeed } from "./l0";
import { identityOrigin, resolveUrl } from "./resolveUrl";
import { expandTemplate, fetchIndex, fetchItem, fetchItems, manifestIssues, surfaceOf } from "./surface";
import { id } from "../core/testing";

// --- A fetcher that serves a table of URLs and counts what it was asked for -----

function site(routes: Record<string, string | { text: string; status?: number; url?: string }>) {
  const asked: string[] = [];
  const fetcher: Fetcher = async (url) => {
    asked.push(url);
    const route = routes[url];
    if (route === undefined) return { url, status: 404, contentType: "text/html", text: "not found", redirects: 0 };
    const { text, status = 200, url: finalUrl = url } = typeof route === "string" ? { text: route } : route;
    return { url: finalUrl, status, contentType: null, text, redirects: finalUrl === url ? 0 : 1 } satisfies FetchResult;
  };
  return { fetcher, asked };
}

const MANIFEST = JSON.stringify({ blyg: "0.4", title: "T", updated: "2026-10-01T00:00:00Z" });
const RSS = (extra = "") => `<?xml version="1.0"?><rss version="2.0" xmlns:blyg="https://blygger.org/ns/0.1"><channel><title>Feed</title>${extra}<item><title>One</title><link>https://e.test/1</link><guid>g1</guid><description>&lt;p&gt;Sum&lt;/p&gt;</description></item></channel></rss>`;

describe("resolution (§12.1)", () => {
  it("1-2. normalizes (strips query and fragment, adds a trailing slash) and probes blyg.json", async () => {
    const { fetcher, asked } = site({ "https://e.test/blyg/blyg.json": MANIFEST });
    const result = await resolveUrl("https://e.test/blyg?x=1#frag", fetcher);
    expect(result).toMatchObject({ kind: "blyg", origin: "https://e.test/blyg/", manifestUrl: "https://e.test/blyg/blyg.json" });
    expect(asked).toEqual(["https://e.test/blyg/blyg.json"]);
  });

  it("does not trust Content-Type: parse success is the test", async () => {
    const { fetcher } = site({ "https://e.test/blyg.json": { text: MANIFEST } });
    expect((await resolveUrl("https://e.test/", fetcher)).kind).toBe("blyg");
  });

  it("a 200 that is not a manifest (a single-page app's fallback) is not one", async () => {
    const { fetcher } = site({ "https://e.test/x/blyg.json": "<!doctype html><p>app</p>", "https://e.test/x/": "<p>no link</p>" });
    expect((await resolveUrl("https://e.test/x/", fetcher)).kind).toBe("failed");
  });

  it("3. a feed with <blyg:manifest> upgrades to the blyg it names, and identity is where the manifest came from (§12.2)", async () => {
    const { fetcher } = site({
      "https://e.test/feed.xml": RSS("<blyg:manifest>https://e.test/wp-json/blyg/v1/manifest</blyg:manifest>"),
      "https://e.test/wp-json/blyg/v1/manifest": MANIFEST,
    });
    expect(await resolveUrl("https://e.test/feed.xml", fetcher)).toMatchObject({
      kind: "blyg",
      origin: "https://e.test/wp-json/blyg/v1/",
    });
  });

  it("follows redirects: the final URL wins as the origin, across hosts", async () => {
    const { fetcher } = site({ "https://old.test/blyg/blyg.json": { text: MANIFEST, url: "https://new.test/moved/blyg.json" } });
    expect(await resolveUrl("https://old.test/blyg/", fetcher)).toMatchObject({ origin: "https://new.test/moved/" });
  });

  it("4. a rel=blyg link whose target is a manifest is the manifest", async () => {
    const { fetcher } = site({
      "https://e.test/post": '<html><head><link rel="blyg" href="/api/manifest"></head></html>',
      "https://e.test/api/manifest": MANIFEST,
    });
    expect(await resolveUrl("https://e.test/post", fetcher)).toMatchObject({ kind: "blyg", origin: "https://e.test/api/" });
  });

  it("4. otherwise the rel href is an origin base: append blyg.json", async () => {
    const { fetcher } = site({
      "https://e.test/post": '<link rel="blyg" href="https://other.test/b/">',
      "https://other.test/b/blyg.json": MANIFEST,
    });
    expect(await resolveUrl("https://e.test/post", fetcher)).toMatchObject({ origin: "https://other.test/b/" });
  });

  it("4. one hop only: a rel target's own HTML is never scanned", async () => {
    const { fetcher, asked } = site({
      "https://e.test/post": '<link rel="blyg" href="https://a.test/page">',
      "https://a.test/page": '<link rel="blyg" href="https://b.test/b/">',
      "https://b.test/b/blyg.json": MANIFEST,
    });
    expect((await resolveUrl("https://e.test/post", fetcher)).kind).toBe("failed");
    expect(asked).not.toContain("https://b.test/b/blyg.json");
  });

  it("5. conventional-mount probes: /blyg/blyg.json, then /blyg.json, at the host root", async () => {
    const { fetcher, asked } = site({ "https://e.test/some/page": "<p>nothing</p>", "https://e.test/blyg.json": MANIFEST });
    expect(await resolveUrl("https://e.test/some/page", fetcher)).toMatchObject({ kind: "blyg", origin: "https://e.test/" });
    expect(asked).toEqual([
      "https://e.test/some/page/blyg.json",
      "https://e.test/some/page",
      "https://e.test/blyg/blyg.json",
      "https://e.test/blyg.json",
    ]);
  });

  it("5. skips a probe it already made", async () => {
    const { fetcher, asked } = site({});
    await resolveUrl("https://e.test/blyg/", fetcher);
    expect(asked.filter((url) => url === "https://e.test/blyg/blyg.json")).toHaveLength(1);
  });

  it("6. falls back to plain RSS as an L0 feed", async () => {
    const { fetcher } = site({ "https://e.test/feed": RSS() });
    expect(await resolveUrl("https://e.test/feed", fetcher)).toMatchObject({ kind: "l0", feedUrl: "https://e.test/feed" });
  });

  it("6. or RSS autodiscovery on the page", async () => {
    const { fetcher } = site({
      "https://e.test/": '<link rel="alternate" type="application/rss+xml" href="/rss.xml">',
      "https://e.test/rss.xml": RSS(),
    });
    expect(await resolveUrl("https://e.test/", fetcher)).toMatchObject({ kind: "l0", feedUrl: "https://e.test/rss.xml" });
  });

  it("prefers a manifest found by a later step over the L0 candidate", async () => {
    const { fetcher } = site({ "https://e.test/feed": RSS(), "https://e.test/blyg/blyg.json": MANIFEST });
    expect((await resolveUrl("https://e.test/feed", fetcher)).kind).toBe("blyg");
  });

  it("fails with the trail of URLs tried", async () => {
    const { fetcher } = site({});
    const result = await resolveUrl("https://e.test/nothing", fetcher);
    expect(result.kind).toBe("failed");
    expect(result.trail.join("\n")).toContain("https://e.test/nothing/blyg.json: 404");
    expect(result.trail.join("\n")).toContain("https://e.test/blyg.json: 404");
  });

  it("makes at most 6 fetches, however hard it is made to try", async () => {
    const { fetcher, asked } = site({
      "https://e.test/post": '<link rel="blyg" href="https://e.test/rel/"><link rel="alternate" type="application/rss+xml" href="/rss.xml">',
      "https://e.test/rss.xml": RSS(),
    });
    const result = await resolveUrl("https://e.test/post", fetcher);
    expect(asked.length).toBeLessThanOrEqual(6);
    expect(result.trail.join("\n")).toContain("budget");
  });

  it("records a network failure in the trail and goes on", async () => {
    const flaky: Fetcher = async (url) => {
      if (url === "https://e.test/x/blyg.json") throw new FetchError(url, "connection reset");
      return { url, status: url === "https://e.test/blyg.json" ? 200 : 404, contentType: null, text: MANIFEST, redirects: 0 };
    };
    const result = await resolveUrl("https://e.test/x/", flaky);
    expect(result.kind).toBe("blyg");
    expect(result.trail.join("\n")).toContain("connection reset");
  });

  it("identity origin is the manifest URL minus its last segment, query ignored", () => {
    expect(identityOrigin("https://e.test/blyg/blyg.json")).toBe("https://e.test/blyg/");
    expect(identityOrigin("https://e.test/wp-json/blyg/v1/manifest?x=1")).toBe("https://e.test/wp-json/blyg/v1/");
  });
});

describe("the polite fetcher", () => {
  const response = (body: string, init: ResponseInit = {}) => new Response(body, init);

  it("sends an identifying User-Agent, follows and counts redirects, and reports the final URL", async () => {
    const seen: Array<{ url: string; agent: string | null }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push({ url, agent: new Headers(init?.headers).get("user-agent") });
      return url.endsWith("/a") ? response("", { status: 302, headers: { location: "/b" } }) : response("done");
    }) as unknown as typeof fetch;
    const result = await politeFetcher({ userAgent: "test/1", fetch: fake })("https://e.test/a");
    expect(result).toMatchObject({ url: "https://e.test/b", status: 200, text: "done", redirects: 1 });
    expect(seen.every((s) => s.agent === "test/1")).toBe(true);
  });

  it("bounds redirects", async () => {
    const loop = (async () => response("", { status: 302, headers: { location: "/again" } })) as unknown as typeof fetch;
    await expect(politeFetcher({ userAgent: "t", fetch: loop, maxRedirects: 5 })("https://e.test/")).rejects.toThrow(/redirects/);
  });

  it("limits the size of a response", async () => {
    const big = (async () => response("x".repeat(5000))) as unknown as typeof fetch;
    await expect(politeFetcher({ userAgent: "t", fetch: big, maxBytes: 1000 })("https://e.test/")).rejects.toThrow(/limit|bytes/);
  });

  it("times out", async () => {
    const hang = ((_: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    await expect(politeFetcher({ userAgent: "t", fetch: hang, timeoutMs: 20 })("https://e.test/")).rejects.toThrow();
  });

  it("allows at most 4 concurrent requests per host, but not per fetcher", async () => {
    let active = new Map<string, number>();
    let peak = 0;
    let peakAcrossHosts = 0;
    const slow = (async (url: string) => {
      const host = new URL(url).host;
      active.set(host, (active.get(host) ?? 0) + 1);
      peak = Math.max(peak, active.get(host)!);
      peakAcrossHosts = Math.max(peakAcrossHosts, [...active.values()].reduce((a, b) => a + b, 0));
      await new Promise((resolve) => setTimeout(resolve, 15));
      active.set(host, active.get(host)! - 1);
      return response("ok");
    }) as unknown as typeof fetch;
    const fetcher = politeFetcher({ userAgent: "t", fetch: slow, perHost: 4 });
    await Promise.all([
      ...Array.from({ length: 12 }, (_, i) => fetcher(`https://one.test/${i}`)),
      ...Array.from({ length: 12 }, (_, i) => fetcher(`https://two.test/${i}`)),
    ]);
    expect(peak).toBe(4);
    expect(peakAcrossHosts).toBeGreaterThan(4);
  });
});

describe("the publication surface (§4, §6)", () => {
  it("expands RFC 6570 level-1 templates, percent-encoding values and leaving unknown names alone", () => {
    expect(expandTemplate("items/{id}.json", { id: "abc" })).toBe("items/abc.json");
    expect(expandTemplate("v{n}/{id}", { id: "a b/c", n: 2 })).toBe("v2/a%20b%2Fc");
    expect(expandTemplate("{id}'(*)!", { id: "x" })).toBe("x'(*)!");
    expect(expandTemplate("{id}", { id: "it's (a)*!" })).toBe("it%27s%20%28a%29%2A%21");
    expect(expandTemplate("{unknown}/{id}", { id: "x" })).toBe("{unknown}/x");
  });

  it("uses the default paths when the manifest relocates nothing", () => {
    const surface = surfaceOf("https://e.test/blyg/", JSON.parse(MANIFEST));
    expect(surface.feedUrl).toBe("https://e.test/blyg/feed.xml");
    expect(surface.indexUrl).toBe("https://e.test/blyg/items/index.json");
    expect(surface.itemUrl("abc")).toBe("https://e.test/blyg/items/abc.json");
    expect(surface.pinUrl("abc", 2)).toBe("https://e.test/blyg/items/abc/v2.json");
  });

  it("honors a manifest that locates the surface (the spec's WordPress example)", () => {
    const surface = surfaceOf("https://e.test/wp-json/blyg/v1/", {
      blyg: "0.4", title: "T", updated: "x",
      feed: "https://e.test/feed/blyg/",
      items: "https://e.test/wp-json/blyg/v1/items",
      item: "https://e.test/wp-json/blyg/v1/items/{id}",
      pin: "https://e.test/wp-json/blyg/v1/items/{id}/v{n}",
    });
    expect(surface.feedUrl).toBe("https://e.test/feed/blyg/");
    expect(surface.indexUrl).toBe("https://e.test/wp-json/blyg/v1/items");
    expect(surface.itemUrl("abc")).toBe("https://e.test/wp-json/blyg/v1/items/abc");
    expect(surface.pinUrl("abc", 2)).toBe("https://e.test/wp-json/blyg/v1/items/abc/v2");
  });

  it("keeps a query string, which is expanded and fetched, never resolved against", () => {
    const surface = surfaceOf("https://e.test/api/", { blyg: "0.4", title: "T", updated: "x", item: "?rest_route=/blyg/{id}", items: "?rest_route=/blyg" });
    expect(surface.itemUrl("abc")).toBe("https://e.test/api/?rest_route=/blyg/abc");
    expect(surface.indexUrl).toBe("https://e.test/api/?rest_route=/blyg");
  });

  it("notes a manifest without its REQUIRED members, and a `site` that disagrees with the fetch origin", () => {
    expect(manifestIssues("https://e.test/b/", { blyg: "0.4" } as never).map((i) => i.code)).toEqual(["manifest-member", "manifest-member"]);
    expect(manifestIssues("https://e.test/b/", { ...JSON.parse(MANIFEST), site: "https://mirror.test/b/" }).map((i) => i.code)).toEqual(["site-mismatch"]);
    expect(manifestIssues("https://e.test/b/", { ...JSON.parse(MANIFEST), site: "https://e.test/b/" })).toEqual([]);
  });

  const surface = surfaceOf("https://e.test/b/", JSON.parse(MANIFEST));

  it("reads the archive index newest first, skipping entries without a valid id", async () => {
    const { fetcher } = site({
      "https://e.test/b/items/index.json": JSON.stringify({
        items: [
          { id: id(1), kind: "fragment", created: "x", updated: "2026-01-01T00:00:00Z", version: 1 },
          { id: "bad", kind: "fragment", created: "x", updated: "2026-03-01T00:00:00Z", version: 1 },
          { id: id(2), kind: "fragment", created: "x", updated: "2026-02-01T00:00:00Z", version: 1 },
        ],
      }),
    });
    const { index, issues } = await fetchIndex(surface, fetcher);
    expect(index?.items.map((entry) => entry.id)).toEqual([id(2), id(1)]);
    expect(issues.map((i) => i.code)).toEqual(["index-entry"]);
  });

  it("reports a missing index (a nonconforming publisher) and a fetch failure", async () => {
    expect((await fetchIndex(surface, site({}).fetcher)).issues[0]?.code).toBe("index-status");
    const down: Fetcher = async (url) => { throw new FetchError(url, "down"); };
    expect((await fetchIndex(surface, down)).issues[0]?.code).toBe("fetch-failed");
  });

  it("fetches the newest items up to the limit, recording failures and never aborting", async () => {
    const entries = [1, 2, 3, 4].map((n) => ({ id: id(n), kind: "fragment", created: "x", updated: `2026-0${n}-01T00:00:00Z`, version: 1 }));
    const { fetcher, asked } = site({
      [`https://e.test/b/items/${id(4)}.json`]: JSON.stringify({ id: id(4) }),
      [`https://e.test/b/items/${id(3)}.json`]: { text: "gone", status: 500 },
      [`https://e.test/b/items/${id(2)}.json`]: "not json",
    });
    const { items, issues } = await fetchItems(surface, { items: entries.reverse() }, fetcher, 3);
    expect(asked.sort()).toEqual([2, 3, 4].map((n) => `https://e.test/b/items/${id(n)}.json`).sort());
    expect(items.map((item) => item.id)).toEqual([id(4)]);
    expect(issues.map((i) => i.code).sort()).toEqual(["item-json", "item-status"]);
    expect((await fetchItem(surface, id(1), fetcher)).raw).toBeUndefined();
  });
});

describe("L0 wrapper (§13.6)", () => {
  const { title, items } = wrapFeed("https://e.test/feed", RSS());

  it("makes summary rows with synthetic ids that are never valid blyg ids", () => {
    expect(title).toBe("Feed");
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toMatch(/^l0:/);
    expect(isValidId(items[0]!.id)).toBe(false);
    expect(items[0]!.content_html).toContain('<a href="https://e.test/1">One</a>');
  });

  it("derives the id deterministically from the GUID", () => {
    expect(wrapFeed("https://e.test/feed", RSS()).items[0]!.id).toBe(items[0]!.id);
  });

  it("wraps Atom too, and truncates the summary", () => {
    const long = "word ".repeat(200);
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><id>tag:1</id><title>T</title><link href="https://e.test/a"/><updated>2026-01-02T03:04:05Z</updated><summary>${long}</summary></entry></feed>`;
    const wrapped = wrapFeed("https://e.test/atom", atom);
    expect(wrapped.items[0]!.updated).toBe("2026-01-02T03:04:05Z");
    expect(wrapped.items[0]!.content_md.length).toBeLessThan(400);
    expect(wrapped.items[0]!.content_md.endsWith("…")).toBe(true);
  });
});
