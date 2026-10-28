// DOM selection -> §10.2 text content, in a real layout engine. The property
// that matters most in this repo: a selection over a rendered item yields
// offsets whose text is a substring of the item's spec text content, and a
// partial quote written from it survives the publish-time check.

import { beforeAll, describe, expect, it } from "vitest";
import { bake } from "../src/core/bake";
import { insertPartialQuote } from "../src/core/draft";
import { Store, type StoredItem } from "../src/core/store";
import { textContent } from "../src/core/textContent";
import { loadFixtures } from "../src/feeds/fixtures";
import { domText, rangeFromOffsets, readSelection, selectionOffsets } from "../src/harness/domText";
import { sanitize } from "../src/harness/sanitize";

const files = import.meta.glob("../fixtures/**/*.json", { import: "default" }) as Record<string, () => Promise<unknown>>;
const read = async (path: string) => files[`../fixtures/${path}`]!();

const store = new Store();
let items: StoredItem[] = [];
beforeAll(async () => {
  const { index } = await loadFixtures(store, read);
  items = index.sources.filter((s) => s.level === "blyg").flatMap((s) => store.items(s.origin));
}, 60_000);

function prng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function render(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = sanitize(html);
  document.body.append(host);
  return host;
}

const stripSpace = (text: string) => text.replace(/\s/g, "");

describe("the DOM walk agrees with the spec's text content", () => {
  it("fixtures were loaded", () => {
    expect(items.length).toBeGreaterThan(300);
  });

  it("walking a rendered item gives the same text content as parsing its sanitized HTML, for every fixture item", () => {
    const different: string[] = [];
    for (const row of items) {
      const html = sanitize(row.doc.content_html);
      const host = document.createElement("div");
      host.innerHTML = html;
      if (domText(host).layout.text !== textContent(html)) different.push(`${row.origin} ${row.id}`);
    }
    expect(different).toEqual([]);
  });

  it("and the same as the stored item's text content, except where sanitizing removed something", () => {
    const changed: string[] = [];
    for (const row of items) {
      const host = document.createElement("div");
      host.innerHTML = sanitize(row.doc.content_html);
      if (domText(host).layout.text !== textContent(row.doc.content_html)) changed.push(`${row.origin} ${row.id}`);
    }
    if (changed.length > 0) console.warn("sanitizing changed the text content of:", changed);
    // Report, don't hide: readSelection falls back to the stored text for these.
    expect(changed.length).toBeLessThan(items.length * 0.02);
  });
});

describe("programmatic selections over rendered fixture items", () => {
  it("every selection's offsets index the spec text content, and the text there is what was selected", () => {
    const next = prng(2026);
    let checked = 0;
    for (const row of items) {
      const host = render(row.doc.content_html);
      const dt = domText(host);
      const stored = textContent(row.doc.content_html);
      if (dt.nodes.length < 2 || dt.layout.text !== stored) { host.remove(); continue; }

      for (let n = 0; n < 4; n++) {
        const a = dt.nodes[Math.floor(next() * dt.nodes.length)]!;
        const b = dt.nodes[Math.floor(next() * dt.nodes.length)]!;
        const [first, second] = a.start <= b.start ? [a, b] : [b, a];
        const range = document.createRange();
        range.setStart(first.node, Math.floor(next() * (first.node.data.length + 1)));
        range.setEnd(second.node, Math.floor(next() * (second.node.data.length + 1)));
        if (range.collapsed) continue;

        const hit = selectionOffsets(dt, range);
        if (!hit) continue; // whitespace only
        checked++;
        expect(stored.slice(hit.start, hit.end), `${row.id}`).toBe(hit.exact);
        expect(stored.includes(hit.exact)).toBe(true);
        // The browser's own idea of the selected characters, whitespace aside.
        expect(stripSpace(hit.exact), `${row.id}`).toBe(stripSpace(range.toString()));

        // The inverse mapping lands on the same offsets.
        const back = rangeFromOffsets(dt, hit.start, hit.end)!;
        expect(selectionOffsets(dt, back)).toEqual(hit);
      }
      host.remove();
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("a partial quote written from a selection passes the publish-time check", () => {
    const next = prng(7);
    const ctx = { origin: "http://localhost:5173/blyg/", draftId: "0".repeat(26) };
    let baked = 0;
    for (const row of items) {
      if (row.doc.content_md === "") continue;
      const host = render(row.doc.content_html);
      const dt = domText(host);
      if (dt.nodes.length === 0 || dt.layout.text !== textContent(row.doc.content_html)) { host.remove(); continue; }

      const a = dt.nodes[Math.floor(next() * dt.nodes.length)]!;
      const b = dt.nodes[Math.floor(next() * dt.nodes.length)]!;
      const [first, second] = a.start <= b.start ? [a, b] : [b, a];
      const range = document.createRange();
      range.setStart(first.node, Math.floor(next() * (first.node.data.length + 1)));
      range.setEnd(second.node, Math.floor(next() * (second.node.data.length + 1)));
      // (Removing the host first would reset the range: live ranges move out of a removed subtree.)
      const hit = selectionOffsets(dt, range);
      host.remove();
      if (!hit) continue;

      const md = insertPartialQuote("", 0, row.id, hit.exact);
      const result = bake(md, store, ctx);
      expect(result.errors, `${row.origin} ${row.id} ${JSON.stringify(hit.exact)}`).toEqual([]);
      expect(result.transclusions[0]?.selector?.exact).toBe(hit.exact);
      baked++;
    }
    expect(baked).toBeGreaterThan(200);
  });

  it("maps a selection that starts and ends at element boundaries, not text nodes", () => {
    const host = render("<p>Alpha   beta</p><p>gamma <em>delta</em></p>");
    const dt = domText(host);
    const range = document.createRange();
    range.setStart(host, 0);
    range.setEnd(host, host.childNodes.length);
    expect(selectionOffsets(dt, range)?.exact).toBe("Alpha beta\ngamma delta");
    range.selectNode(host.querySelector("em")!);
    expect(selectionOffsets(dt, range)?.exact).toBe("delta");
    range.selectNodeContents(host.children[1]!);
    expect(selectionOffsets(dt, range)?.exact).toBe("gamma delta");
    host.remove();
  });

  it("keeps the line break when a selection crosses blocks, and trims whitespace at its edges", () => {
    const host = render("<p>Alpha   beta</p>\n<p>gamma</p>");
    const dt = domText(host);
    const p1 = host.querySelectorAll("p")[0]!.firstChild as Text;
    const p2 = host.querySelectorAll("p")[1]!.firstChild as Text;
    const range = document.createRange();
    range.setStart(p1, 5); // inside the whitespace run after "Alpha"
    range.setEnd(p2, 3); // after "gam"
    const hit = selectionOffsets(dt, range)!;
    expect(hit.exact).toBe("beta\ngam");
    expect(textContent("<p>Alpha   beta</p>\n<p>gamma</p>").slice(hit.start, hit.end)).toBe("beta\ngam");
    host.remove();
  });

  it("works through the real Selection object", () => {
    const host = render("<p>Stigmergy is what a protocol looks like from inside.</p>");
    const dt = domText(host);
    const node = host.querySelector("p")!.firstChild!;
    const selection = getSelection()!;
    selection.removeAllRanges();
    const range = document.createRange();
    range.setStart(node, 13);
    range.setEnd(node, 34);
    selection.addRange(range);
    const hit = selectionOffsets(dt, selection.getRangeAt(0))!;
    expect(hit.exact).toBe("what a protocol looks");
    selection.removeAllRanges();
    host.remove();
  });

  it("an offset range maps back to a DOM range over exactly those characters", () => {
    const host = render("<p>one two</p><p>three <b>four</b></p>");
    const dt = domText(host);
    const text = dt.layout.text; // "one two\nthree four"
    const start = text.indexOf("two");
    const range = rangeFromOffsets(dt, start, text.indexOf("four") + 4)!;
    expect(stripSpace(range.toString())).toBe("twothreefour");
    expect(selectionOffsets(dt, range)?.exact).toBe("two\nthree four");
    expect(rangeFromOffsets(dt, 7, 8)).toBeNull(); // only the line break
    host.remove();
  });

  it("allows a selection inside a baked nested quote: it is still a substring of the outer item's text", () => {
    const outer = items.find((row) => row.doc.kind === "thread" && /<blockquote class="blyg-transclusion[^"]*"[^>]*>\s*<p>[^<]{40,}/.test(row.doc.content_html));
    expect(outer, "a fixture thread with a nested quote").toBeDefined();
    const host = render(outer!.doc.content_html);
    const dt = domText(host);
    const inner = host.querySelector("blockquote.blyg-transclusion p")!;
    const node = inner.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(30, node.data.length));
    const reading = readSelection(dt, range, textContent(outer!.doc.content_html));
    expect(reading.valid).toBe(true);
    expect(textContent(outer!.doc.content_html).includes(reading.exact!)).toBe(true);
    host.remove();
  });
});

describe("readSelection when sanitizing changed the text", () => {
  it("falls back to the stored text content, and refuses what is not in it", () => {
    const host = render("<p>kept</p>");
    const dt = domText(host);
    const range = document.createRange();
    range.selectNodeContents(host);
    expect(readSelection(dt, range, "kept")).toEqual({ valid: true, start: 0, end: 4, exact: "kept" });
    expect(readSelection(dt, range, "before\nkept")).toEqual({ valid: true, start: 7, end: 11, exact: "kept" });
    expect(readSelection(dt, range, "something else")).toMatchObject({ valid: false });
    host.remove();
  });
});
