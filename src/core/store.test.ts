import { describe, expect, it } from "vitest";
import { contentHash } from "./hash";
import { readItemDocument, Store } from "./store";
import { id, item, REMOTE } from "./testing";

const A = id(1);
const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe("lenient ingest (§13.1, §13.3)", () => {
  it("a conforming document has no issues", () => {
    expect(readItemDocument(REMOTE, item(A)).issues).toEqual([]);
    expect(readItemDocument(REMOTE, item(A, { kind: "thread" })).issues).toEqual([]);
    expect(readItemDocument(REMOTE, item(A, { kind: "withdrawn", version: 2 })).issues).toEqual([]);
  });

  it("records missing REQUIRED members and imports anyway", () => {
    const { content_hash, changelog, ...partial } = item(A);
    void content_hash; void changelog;
    const store = new Store();
    const issues = store.ingest(REMOTE, partial);
    expect(issues.filter((i) => i.code === "missing-member").map((i) => i.message)).toEqual([
      "missing REQUIRED member `content_hash`",
      "missing REQUIRED member `changelog`",
    ]);
    expect(store.get(REMOTE, A)).toBeDefined();
  });

  it("records a malformed id and imports anyway", () => {
    const store = new Store();
    const issues = store.ingest(REMOTE, { ...item(A), id: "not-an-id" });
    expect(codes(issues)).toContain("malformed-id");
    expect(store.get(REMOTE, "not-an-id")).toBeDefined();
  });

  it("reports a content_hash mismatch (§13.3) and adopts the content anyway", () => {
    const store = new Store();
    const issues = store.ingest(REMOTE, { ...item(A, { md: "real words" }), content_hash: contentHash("other words") });
    expect(codes(issues)).toEqual(["hash-mismatch"]);
    expect(store.get(REMOTE, A)?.doc.content_md).toBe("real words");
  });

  it("ignores unknown kinds, without rejecting anything else", () => {
    const store = new Store();
    expect(codes(store.ingest(REMOTE, { ...item(A), kind: "poll" }))).toEqual(["unknown-kind"]);
    expect(store.get(REMOTE, A)).toBeUndefined();
    expect(store.ingest(REMOTE, item(id(2)))).toEqual([]);
  });

  it("preserves unknown members verbatim", () => {
    const store = new Store();
    const raw = { ...item(A), future_member: { nested: [1, 2, 3] }, author: { name: "N", wallet: "0xabc" } };
    store.ingest(REMOTE, raw);
    expect(store.get(REMOTE, A)?.doc).toEqual(raw);
  });

  it("notes a document that names a different origin, and scopes it to where it was fetched from", () => {
    const store = new Store();
    const issues = store.ingest(REMOTE, { ...item(A), origin: " https://remote.test/blyg/" });
    expect(codes(issues)).toEqual(["origin-mismatch"]);
    expect(store.get(REMOTE, A)).toBeDefined();
  });

  it("notes relative URLs in content_html (§5.2), updated disagreeing with the changelog, and malformed references", () => {
    const issues = readItemDocument(REMOTE, {
      ...item(A, { kind: "thread", html: '<p><a href="/x">x</a></p>' }),
      updated: "2026-10-02T00:00:00Z",
      transclusions: [{ id: "bad", version: 1 }, { id: id(3), version: 0 }, { id: id(4), version: 1, selector: {} }],
    }).issues;
    expect(codes(issues).sort()).toEqual(["bad-reference", "bad-reference", "malformed-id", "relative-url", "updated-mismatch"].sort());
  });

  it("requires transclusions on a thread", () => {
    const { transclusions, ...thread } = item(A, { kind: "thread" });
    void transclusions;
    expect(readItemDocument(REMOTE, thread).issues[0]?.message).toContain("transclusions");
  });

  it("accepts any 0.x blyg value", () => {
    expect(readItemDocument(REMOTE, { ...item(A), blyg: "0.9" }).issues).toEqual([]);
    expect(codes(readItemDocument(REMOTE, { ...item(A), blyg: "1.0" }).issues)).toEqual(["unexpected-spec-version"]);
  });

  it("does not throw on junk", () => {
    for (const junk of [null, 3, "x", [], {}, { id: 4 }]) expect(() => readItemDocument(REMOTE, junk)).not.toThrow();
  });

  it("does not mutate what it reads", () => {
    const raw = item(A);
    const before = JSON.stringify(raw);
    new Store().ingest(REMOTE, raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe("rollup and the watermark (§13.1, §13.3, §13.4)", () => {
  it("the highest version wins", () => {
    const store = new Store();
    store.ingest(REMOTE, item(A, { version: 2, md: "two" }));
    store.ingest(REMOTE, item(A, { version: 3, md: "three" }));
    expect(store.get(REMOTE, A)?.doc.version).toBe(3);
    expect(store.watermark(REMOTE, A)).toBe(3);
  });

  it("never silently adopts a lower version", () => {
    const store = new Store();
    store.ingest(REMOTE, item(A, { version: 3, md: "three" }));
    const issues = store.ingest(REMOTE, item(A, { version: 2, md: "two" }));
    expect(codes(issues)).toEqual(["version-regression"]);
    expect(store.get(REMOTE, A)?.doc.content_md).toBe("three");
  });

  it("adopts and records a stealth edit: same version, different content", () => {
    const store = new Store();
    store.ingest(REMOTE, item(A, { version: 2, md: "before" }));
    const issues = store.ingest(REMOTE, item(A, { version: 2, md: "after" }));
    expect(codes(issues)).toEqual(["stealth-edit"]);
    expect(store.get(REMOTE, A)?.doc.content_md).toBe("after");
    expect(store.watermark(REMOTE, A)).toBe(2);
  });

  it("a withdrawal endcap rolls the item up to withdrawn, and the watermark survives it", () => {
    const store = new Store();
    store.ingest(REMOTE, item(A, { version: 2 }));
    store.ingest(REMOTE, item(A, { kind: "withdrawn", version: 3 }));
    expect(store.get(REMOTE, A)).toMatchObject({ state: "withdrawn", doc: { content_html: "" } });
    expect(store.items(REMOTE)).toEqual([]);
    expect(codes(store.ingest(REMOTE, item(A, { version: 3, md: "replay" })))).toContain("stealth-edit");
    expect(codes(store.ingest(REMOTE, item(A, { version: 2, md: "older" })))).toEqual(["version-regression"]);
    // The item returning: a later version under the same id.
    store.ingest(REMOTE, item(A, { version: 4, md: "back" }));
    expect(store.get(REMOTE, A)?.state).toBe("current");
  });

  it("scopes every id to its origin", () => {
    const store = new Store();
    store.ingest(REMOTE, item(A, { md: "from remote" }));
    store.ingest("https://other.test/", item(A, { origin: "https://other.test/", md: "from other" }));
    expect(store.get(REMOTE, A)?.doc.content_md).toBe("from remote");
    expect(store.byId(A)).toHaveLength(2);
  });

  it("only a pin keeps a withdrawn item's snapshot, and only a withdrawn item takes one", () => {
    const store = new Store();
    store.ingest(REMOTE, item(A, { version: 1 }));
    store.retain(REMOTE, item(A, { version: 1 }));
    expect(store.get(REMOTE, A)?.retained).toBeUndefined();
    store.ingest(REMOTE, item(A, { kind: "withdrawn", version: 2 }));
    store.retain(REMOTE, item(A, { version: 1 }));
    expect(store.get(REMOTE, A)?.retained?.version).toBe(1);
  });

  it("notifies subscribers", () => {
    const store = new Store();
    let calls = 0;
    store.subscribe(() => calls++);
    store.ingest(REMOTE, item(A));
    expect(calls).toBe(1);
    expect(store.revision).toBe(1);
  });
});
