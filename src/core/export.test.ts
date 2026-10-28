import { describe, expect, it } from "vitest";
import { exportDocument, newDraftMeta, DEFAULT_ORIGIN } from "./export";
import { contentHash } from "./hash";
import { isValidId } from "./ids";
import { Store } from "./store";
import { id, item, REMOTE, OTHER } from "./testing";
import { textContent } from "./textContent";

const A = id(1);
const B = id(2);
const meta = { id: id(999), created: "2026-10-28T12:00:00Z", origin: DEFAULT_ORIGIN };

function stored() {
  const store = new Store();
  store.addSource({ origin: REMOTE, level: "blyg", title: "Remote Blyg" });
  store.ingest(REMOTE, { ...item(A, { md: "Before it. The middle bit. After it.", version: 4, page: "f/custom/" }), author: { name: "Ann" } });
  store.ingest(OTHER, item(B, { origin: OTHER, md: "Other words." }));
  return store;
}

describe("exportDocument (§5)", () => {
  const md = `Intro.\n\n![[${A}]]\n> The middle bit.\n\n![[${B} | other]]\n\nSee [[${A}]].\n`;
  const result = exportDocument(md, meta, stored());

  it("is a complete thread item document", () => {
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const doc = result.doc;
    expect(Object.keys(doc)).toEqual([
      "blyg", "id", "kind", "origin", "page", "created", "updated", "version", "content_md", "content_html", "content_hash",
      "media", "changelog", "transclusions", "links",
    ]);
    expect(doc).toMatchObject({
      blyg: "0.4", kind: "thread", id: meta.id, origin: DEFAULT_ORIGIN, page: `t/${meta.id}/`, version: 1,
      created: meta.created, updated: meta.created, content_md: md, content_hash: contentHash(md), media: [],
      changelog: [{ version: 1, at: meta.created, note: null }],
    });
  });

  it("emits transclusions in directive order, every one carrying origin, with selector on the partial", () => {
    if (!result.ok) throw new Error("not ok");
    expect(result.doc.transclusions).toEqual([
      {
        id: A, version: 4, origin: REMOTE,
        selector: { exact: "The middle bit.", prefix: "Before it. ", suffix: " After it." },
        cited: { source: "Remote Blyg", author: "Ann", url: `${REMOTE}f/custom/`, retrieved: meta.created },
      },
      { id: B, version: 1, origin: OTHER, cited: { url: `${OTHER}f/${B}/`, retrieved: meta.created } },
    ]);
    for (const entry of result.doc.transclusions!) expect(entry.cited?.excerpt).toBeUndefined();
  });

  it("emits links[] when there are links", () => {
    if (!result.ok) throw new Error("not ok");
    expect(result.doc.links).toEqual([{ id: A, origin: REMOTE }]);
  });

  it("omits links when there are none", () => {
    const plain = exportDocument(`![[${B}]]\n`, meta, stored());
    if (!plain.ok) throw new Error("not ok");
    expect("links" in plain.doc).toBe(false);
  });

  it("has a baked content_html", () => {
    if (!result.ok) throw new Error("not ok");
    expect(result.doc.content_html).toContain('class="blyg-transclusion blyg-partial"');
    expect(result.doc.content_html).toContain('data-blyg-label="other"');
    expect(result.doc.content_html).toContain(`href="${REMOTE}f/custom/"`);
  });

  it("re-imports through the same lenient reader with zero issues", () => {
    if (!result.ok) throw new Error("not ok");
    const reader = new Store();
    expect(reader.ingest(DEFAULT_ORIGIN, JSON.parse(JSON.stringify(result.doc)))).toEqual([]);
  });

  it("every partial selection in it re-checks as valid against the version it names", () => {
    if (!result.ok) throw new Error("not ok");
    const store = stored();
    let checked = 0;
    for (const entry of result.doc.transclusions!) {
      if (!entry.selector) continue;
      const target = store.get(entry.origin ?? DEFAULT_ORIGIN, entry.id)!;
      expect(target.doc.version).toBe(entry.version);
      expect(textContent(target.doc.content_html).includes(entry.selector.exact)).toBe(true);
      checked++;
    }
    expect(checked).toBe(1);
  });

  it("refuses a draft with publish errors, naming them", () => {
    const bad = exportDocument(`![[${id(50)}]]\n`, meta, stored());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toMatchObject([{ code: "unknown" }]);
  });

  it("an empty draft exports as an empty thread", () => {
    const empty = exportDocument("", meta, new Store());
    if (!empty.ok) throw new Error("not ok");
    expect(empty.doc).toMatchObject({ content_md: "", content_html: "", transclusions: [] });
    expect(new Store().ingest(DEFAULT_ORIGIN, empty.doc)).toEqual([]);
  });
});

describe("newDraftMeta", () => {
  it("makes a valid id, an ISO 8601 UTC instant, and the placeholder origin", () => {
    const made = newDraftMeta(new Date("2026-10-28T12:00:00.123Z"));
    expect(isValidId(made.id)).toBe(true);
    expect(made.created).toBe("2026-10-28T12:00:00Z");
    expect(made.origin).toBe("http://localhost:5173/blyg/");
  });
});
