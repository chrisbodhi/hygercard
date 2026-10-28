// Core against real publishers' documents: the fixtures `bun run snapshot` captured.
// A failure here is either a bug in core or a publisher's; scripts/findings.ts
// prints the details.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Store } from "../core/store";
import { loadFixtures, type FixtureIndex } from "./fixtures";
import { allItems, checkSelectors, grammarRoundTrip, rebake, wrapperShapes } from "./findings";

const root = new URL("../../fixtures/", import.meta.url).pathname;
const read = async (path: string) => JSON.parse(readFileSync(root + path, "utf8")) as unknown;

const store = new Store();
const { index, issues } = await loadFixtures(store, read);
const items = allItems(store, index as FixtureIndex);
const generatorOf = (origin: string) => store.source(origin)?.manifest?.generator ?? "";

describe("fixtures", () => {
  it("were captured, from several sources", () => {
    expect(index.sources.length).toBeGreaterThan(10);
    expect(items.length).toBeGreaterThan(300);
    expect(index.specPin).toBe(/\*\*Commit\*\* \| `([0-9a-f]{40})`/.exec(readFileSync(root + "../SPEC_PIN.md", "utf8"))![1]);
  });

  it("round-trip through the grammar losslessly: serialize(parse(content_md)) === content_md, for every item", () => {
    const { checked, failures } = grammarRoundTrip(items);
    expect(failures).toEqual([]);
    expect(checked).toBe(items.length);
  });
});

describe("ids and hashes", () => {
  const ID = /^[0-9a-hjkmnp-tv-z]{26}$/;
  const independent = (md: string) => "sha256:" + createHash("sha256").update(md, "utf8").digest("hex");

  it("our reader reports exactly the hash mismatches and malformed ids that an independent check finds", () => {
    const expected = { hash: new Set<string>(), id: new Set<string>() };
    for (const source of index.sources.filter((s) => s.level === "blyg")) {
      for (const id of source.itemIds) {
        const doc = JSON.parse(readFileSync(`${root}${source.slug}/items/${id}.json`, "utf8")) as { id: string; content_md: string; content_hash: string };
        if (independent(doc.content_md) !== doc.content_hash) expected.hash.add(`${source.origin} ${doc.id}`);
        if (!ID.test(doc.id)) expected.id.add(`${source.origin} ${doc.id}`);
      }
    }
    const reported = {
      hash: new Set(issues.filter((i) => i.code === "hash-mismatch").map((i) => i.where)),
      id: new Set(issues.filter((i) => i.code === "malformed-id").map((i) => i.where)),
    };
    expect([...reported.hash].sort()).toEqual([...expected.hash].sort());
    expect([...reported.id].sort()).toEqual([...expected.id].sort());
    if (expected.hash.size + expected.id.size > 0) console.warn("publisher findings:", { hash: [...expected.hash], id: [...expected.id] });
  });
});

describe("partial-selector conformance (§10.2)", () => {
  const checks = checkSelectors(store, items);

  it("finds the real partial quotes", () => {
    expect(checks.length).toBeGreaterThan(10);
  });

  it("every selector whose target is in the fixtures at the referenced version is a substring of the target's text content", () => {
    const failed = checks.filter((c) => c.result === "failed");
    if (failed.length > 0) console.error("selector findings:", failed);
    expect(failed).toEqual([]);
    expect(checks.filter((c) => c.result === "ok").length).toBeGreaterThan(10);
  });

  it("counts what it could not check", () => {
    const counts: Record<string, number> = {};
    for (const check of checks) counts[check.result] = (counts[check.result] ?? 0) + 1;
    console.info("selectors:", counts);
    expect(checks.every((c) => ["ok", "failed", "target-absent", "version-moved"].includes(c.result))).toBe(true);
  });
});

describe("re-baking threads published by the reference implementation", () => {
  const studio = items.filter((row) => row.doc.kind === "thread" && generatorOf(row.origin).startsWith("blygger-studio/"));
  const checks = studio.map((row) => rebake(store, row));
  const compared = checks.filter((c) => c.skipped === null);

  it("has a meaningful number of threads to compare", () => {
    expect(compared.length).toBeGreaterThan(50);
  });

  it("reproduces their content_html byte for byte, label attribute aside", () => {
    const different = compared.filter((c) => !c.htmlEqualWithoutLabels);
    if (different.length > 0) console.error("re-bake differences:", different.slice(0, 5));
    expect(different).toEqual([]);
  });

  it("reproduces their transclusions[], selectors and context included", () => {
    expect(compared.filter((c) => !c.transclusionsEqual)).toEqual([]);
  });

  it("differs only where the thread uses a label, which the reference does not bake and §10.2 does", () => {
    const labelOnly = compared.filter((c) => !c.htmlEqual);
    for (const check of labelOnly) {
      const row = store.get(check.origin, check.thread)!;
      expect(row.doc.content_md).toMatch(/!\[\[[0-9a-z]{26}\s*\|/);
    }
  });
});

describe("what publishers do with the bytes §10.2 leaves open", () => {
  it("varies in whitespace and attribute order, so no reader may depend on them", () => {
    const shapes = wrapperShapes(items);
    console.info("wrapper shapes:", shapes);
    expect(shapes.total).toBeGreaterThan(50);
    expect(shapes.newlineAfterOpen).toBeGreaterThan(0);
    expect(shapes.noNewline).toBeGreaterThan(0);
  });
});
