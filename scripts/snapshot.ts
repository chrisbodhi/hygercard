// bun run snapshot [--limit-items N] [--origin URL ...] [--out DIR]
//
// Captures blyg publication surfaces (manifest, archive index, item documents)
// into fixtures/, resolving each source URL through §12. Read-only: GET requests
// only, an identifying User-Agent, at most 4 concurrent requests per host,
// timeouts and size limits. A failure is recorded as an issue and never aborts
// the run.
//
// Default sources: every entry in https://blygger.com/blygs.opml, plus
// https://newschematic.org/blyg/. `--origin` replaces the defaults, and merges
// the result into the existing fixtures/index.json.

import { XMLParser } from "fast-xml-parser";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readItemDocument } from "../src/core/store";
import type { FixtureIndex, FixtureSource } from "../src/feeds/fixtures";
import { politeFetcher, USER_AGENT } from "../src/feeds/http";
import { readSource } from "../src/feeds/read";
import type { CaptureIssue } from "../src/feeds/surface";

const ROOT = new URL("..", import.meta.url).pathname;
let FIXTURES = join(ROOT, "fixtures");
const OPML = "https://blygger.com/blygs.opml";
const ALSO = ["https://newschematic.org/blyg/"];
const CONCURRENT_SOURCES = 6;

function parseArguments(argv: string[]) {
  let limit = 40;
  let out: string | undefined;
  const origins: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (argument === "--limit-items") limit = Number(argv[++i]);
    else if (argument === "--origin") origins.push(argv[++i] ?? "");
    else if (argument === "--out") out = argv[++i];
    else if (argument === "--help" || argument === "-h") {
      console.log("usage: bun run snapshot [--limit-items N] [--origin URL ...] [--out DIR]");
      process.exit(0);
    } else throw new Error(`unknown argument ${argument}`);
  }
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit-items takes a positive integer");
  return { limit, origins, out };
}

const fetcher = politeFetcher({ userAgent: USER_AGENT });

async function opmlSources(): Promise<string[]> {
  const response = await fetcher(OPML);
  if (response.status !== 200) throw new Error(`${OPML} returned ${response.status}`);
  const tree = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(response.text) as Record<string, any>;
  const found: string[] = [];
  const walk = (outline: any) => {
    for (const node of Array.isArray(outline) ? outline : outline ? [outline] : []) {
      // §11: a consumer resolves an entry's xmlUrl through §12; htmlUrl is the fallback.
      const url = node["@_xmlUrl"] ?? node["@_htmlUrl"];
      if (typeof url === "string") found.push(url);
      walk(node.outline);
    }
  };
  walk(tree.opml?.body?.outline);
  return found;
}

const slugOf = (origin: string) => {
  const url = new URL(origin);
  return (url.host + url.pathname).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
};

const writeJson = async (path: string, value: unknown) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
};

async function capture(input: string, limit: number): Promise<{ source?: FixtureSource; failed?: { input: string; trail: string[] } }> {
  const read = await readSource(input, fetcher, limit);
  const capturedAt = new Date().toISOString();
  if (read.kind === "failed") return { failed: { input, trail: read.trail } };

  if (read.kind === "l0") {
    const slug = slugOf(read.feedUrl);
    await rm(join(FIXTURES, slug), { recursive: true, force: true });
    await writeJson(join(FIXTURES, slug, "l0.json"), { title: read.title, items: read.items });
    return {
      source: { slug, input, origin: read.feedUrl, level: "l0", title: read.title, capturedAt, indexed: read.items.length, itemIds: read.items.map((i) => i.id), resolution: read.trail, issues: [] },
    };
  }

  const { origin, manifest } = read;
  const slug = slugOf(origin);
  const issues: CaptureIssue[] = [...read.issues];
  for (const { raw } of read.items) {
    for (const issue of readItemDocument(origin, raw).issues) issues.push({ where: issue.where, code: issue.code, message: issue.message });
  }

  await rm(join(FIXTURES, slug), { recursive: true, force: true });
  await writeJson(join(FIXTURES, slug, "blyg.json"), manifest);
  if (read.index) await writeJson(join(FIXTURES, slug, "items", "index.json"), read.index);
  for (const { id, raw } of read.items) await writeJson(join(FIXTURES, slug, "items", `${id}.json`), raw);

  return {
    source: {
      slug, input, origin, level: "blyg", title: String(manifest.title ?? slug), capturedAt,
      indexed: read.indexed,
      itemIds: read.items.map((item) => item.id),
      resolution: read.trail,
      issues,
    },
  };
}

async function main() {
  const { limit, origins, out } = parseArguments(process.argv.slice(2));
  if (out) FIXTURES = resolve(process.cwd(), out);
  const subset = origins.length > 0;
  const inputs = subset ? origins : [...(await opmlSources()), ...ALSO];
  console.log(`${inputs.length} source(s), up to ${limit} items each`);

  if (!subset) await rm(FIXTURES, { recursive: true, force: true });
  await mkdir(FIXTURES, { recursive: true });

  const sources = new Map<string, FixtureSource>();
  const failed: Array<{ input: string; trail: string[] }> = [];
  const duplicates: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENT_SOURCES }, async () => {
      while (next < inputs.length) {
        const input = inputs[next++]!;
        const result = await capture(input, limit);
        if (result.failed) {
          failed.push(result.failed);
          console.log(`  FAILED  ${input}`);
        } else if (result.source) {
          if (sources.has(result.source.origin)) duplicates.push(input);
          else sources.set(result.source.origin, result.source);
          console.log(`  ${result.source.level.padEnd(4)}  ${result.source.origin}  ${result.source.itemIds.length}/${result.source.indexed} items, ${result.source.issues.length} issue(s)`);
        }
      }
    }),
  );

  // A subset run merges into what is already there.
  let kept: FixtureSource[] = [];
  if (subset) {
    try {
      const existing = JSON.parse(await readFile(join(FIXTURES, "index.json"), "utf8")) as FixtureIndex;
      kept = existing.sources.filter((s) => !sources.has(s.origin));
    } catch {
      // no index yet
    }
  }
  const pin = /\*\*Commit\*\* \| `([0-9a-f]{40})`/.exec(await readFile(join(ROOT, "SPEC_PIN.md"), "utf8"))?.[1] ?? "unknown";
  const index: FixtureIndex & { failed: typeof failed; duplicates: string[] } = {
    capturedAt: new Date().toISOString(),
    specPin: pin,
    limitItems: limit,
    sources: [...kept, ...sources.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    failed,
    duplicates,
  };
  await writeJson(join(FIXTURES, "index.json"), index);

  const issueCount = index.sources.reduce((n, s) => n + s.issues.length, 0);
  console.log(`captured ${index.sources.length} source(s), ${failed.length} failed, ${issueCount} issue(s) -> fixtures/index.json`);
}

await main();
