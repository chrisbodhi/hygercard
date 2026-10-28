import { describe, expect, it } from "vitest";
import { bake } from "./bake";
import { DRAFT_ORIGIN, id, item, OTHER, REMOTE, storeOf } from "./testing";

const ctx = { origin: DRAFT_ORIGIN, draftId: id(999) };
const A = id(1);
const B = id(2);

const html = (md: string, ...docs: Parameters<typeof storeOf>) => bake(md, storeOf(...docs), ctx).html;

describe("bake output, byte for byte (§10.2)", () => {
  it("a whole own-origin quote: wrapper, id, version, no origin", () => {
    const doc = item(A, { origin: DRAFT_ORIGIN, version: 3, html: "<p>Local words.</p>" });
    expect(html(`![[${A}]]`, doc)).toBe(
      `<blockquote class="blyg-transclusion" data-blyg-id="${A}" data-blyg-version="3">\n<p>Local words.</p>\n</blockquote>`,
    );
  });

  it("blank lines after the last quote, or between two, are an empty chunk that still joins", () => {
    const doc = item(A, { origin: DRAFT_ORIGIN, html: "<p>x</p>" });
    const wrapped = `<blockquote class="blyg-transclusion" data-blyg-id="${A}" data-blyg-version="1">\n<p>x</p>\n</blockquote>`;
    expect(html(`![[${A}]]\n`, doc)).toBe(wrapped + "\n");
    expect(html(`![[${A}]]\n![[${A}]]`, doc)).toBe(wrapped + "\n" + wrapped);
    expect(html(`![[${A}]]\n\n![[${A}]]`, doc)).toBe(wrapped + "\n\n" + wrapped);
  });

  it("a whole remote quote adds data-blyg-origin, after the version", () => {
    const doc = item(A, { origin: REMOTE, version: 2, html: "<p>Remote words.</p>" });
    expect(html(`![[${A}]]`, doc)).toBe(
      `<blockquote class="blyg-transclusion" data-blyg-id="${A}" data-blyg-version="2" data-blyg-origin="${REMOTE}">\n<p>Remote words.</p>\n</blockquote>`,
    );
  });

  it("a label adds data-blyg-label last, verbatim and escaped", () => {
    const doc = item(A, { html: "<p>x</p>" });
    expect(html(`![[${A} | the "opening" & more]]`, doc)).toBe(
      `<blockquote class="blyg-transclusion" data-blyg-id="${A}" data-blyg-version="1" data-blyg-origin="${REMOTE}" data-blyg-label="the &quot;opening&quot; &amp; more">\n<p>x</p>\n</blockquote>`,
    );
  });

  it("a label on an own-origin quote has no origin before it", () => {
    const doc = item(A, { origin: DRAFT_ORIGIN, html: "<p>x</p>" });
    expect(html(`![[${A} | named]]`, doc)).toContain(`data-blyg-version="1" data-blyg-label="named">`);
  });

  it("a partial quote: blyg-partial, and one <p> per line of the selection's plain text", () => {
    const doc = item(A, { md: "Alpha beta gamma.\n\nDelta epsilon.", version: 5 });
    expect(html(`![[${A}]]\n> Alpha beta\n> gamma.\n>\n> Delta epsilon.`, doc)).toBe(
      `<blockquote class="blyg-transclusion blyg-partial" data-blyg-id="${A}" data-blyg-version="5" data-blyg-origin="${REMOTE}">\n<p>Alpha beta gamma.</p>\n<p>Delta epsilon.</p>\n</blockquote>`,
    );
  });

  it("a partial quote carries a label too", () => {
    const doc = item(A, { md: "Alpha beta." });
    expect(html(`![[${A} | the claim]]\n> Alpha`, doc)).toBe(
      `<blockquote class="blyg-transclusion blyg-partial" data-blyg-id="${A}" data-blyg-version="1" data-blyg-origin="${REMOTE}" data-blyg-label="the claim">\n<p>Alpha</p>\n</blockquote>`,
    );
  });

  it("escapes the selection rather than letting the target's text become markup", () => {
    const doc = item(A, { html: "<p>a &lt; b and c &gt; d &amp; &#39;e&#39; \"f\"</p>" });
    expect(html(`![[${A}]]\n> a \\< b and c \\> d & 'e' "f"`, doc)).toContain(
      "<p>a &lt; b and c &gt; d &amp; &#39;e&#39; &quot;f&quot;</p>",
    );
  });

  it("emphasis in the source does not survive into a partial quote", () => {
    const doc = item(A, { md: "the *thin* layer" });
    const out = html(`![[${A}]]\n> the thin layer`, doc);
    expect(out).toContain("<p>the thin layer</p>");
    expect(out).not.toContain("<em>");
  });

  it("assembles prose and quotes with one newline between parts", () => {
    const doc = item(A, { origin: DRAFT_ORIGIN, html: "<p>Q</p>" });
    const out = html("Intro.\n\n![[" + A + "]]\n\nOutro.\n", doc);
    expect(out).toBe(
      `<p>Intro.</p>\n\n<blockquote class="blyg-transclusion" data-blyg-id="${A}" data-blyg-version="1">\n<p>Q</p>\n</blockquote>\n<p>Outro.</p>\n`,
    );
  });

  it("nesting is nested blockquotes, the inner snapshot kept as it was", () => {
    const inner = `<blockquote class="blyg-transclusion" data-blyg-id="${B}" data-blyg-version="1">\n<p>Inner.</p>\n</blockquote>`;
    const thread = item(A, { kind: "thread", html: `<p>Outer.</p>\n${inner}` });
    expect(html(`![[${A}]]`, thread)).toBe(
      `<blockquote class="blyg-transclusion" data-blyg-id="${A}" data-blyg-version="1" data-blyg-origin="${REMOTE}">\n<p>Outer.</p>\n${inner}\n</blockquote>`,
    );
  });

  it("every URL is absolute: a quoted snapshot against its own origin, the draft's prose against the draft's", () => {
    const doc = item(A, { html: '<p><a href="/abs/path">x</a> <a href="rel/page">y</a> <img src="media/a.png" alt=""> <a href="https://e.test/">z</a> <a href="#frag">f</a></p>' });
    const out = html(`See [local](notes/here) and ![pic](pic.png).\n\n![[${A}]]`, doc);
    expect(out).toContain('<a href="https://remote.test/abs/path">');
    expect(out).toContain('<a href="https://remote.test/blyg/rel/page">');
    expect(out).toContain('<img src="https://remote.test/blyg/media/a.png" alt="">');
    expect(out).toContain('<a href="https://e.test/">');
    expect(out).toContain('<a href="#frag">');
    expect(out).toContain(`<a href="${DRAFT_ORIGIN}notes/here">`);
    expect(out).toContain(`src="${DRAFT_ORIGIN}pic.png"`);
  });

  it("an empty href is relative too: it names the base", () => {
    expect(html("[here]()\n")).toBe(`<p><a href="${DRAFT_ORIGIN}">here</a></p>\n`);
  });

  it("autolinks bare URLs and schemeless domains, as the reference implementation does", () => {
    expect(html("see blygger.com and https://x.test/y\n")).toBe(
      '<p>see <a href="http://blygger.com">blygger.com</a> and <a href="https://x.test/y">https://x.test/y</a></p>\n',
    );
  });

  it("the draft's own markdown never injects markup", () => {
    expect(html("<script>alert(1)</script> <b>x</b>\n")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt;x&lt;/b&gt;</p>\n");
  });
});

describe("provenance (§10.3)", () => {
  it("one entry per directive, in order, origin omitted for own-origin, selector on partials", () => {
    const local = item(A, { origin: DRAFT_ORIGIN, version: 2, md: "Local one." });
    const remote = item(B, { origin: REMOTE, version: 7, md: "Before it. The middle bit. After it." });
    const result = bake(`![[${B}]]\n> The middle bit.\n\n![[${A}]]\n\n![[${B}]]\n`, storeOf(local, remote), ctx);
    expect(result.errors).toEqual([]);
    expect(result.transclusions).toEqual([
      { id: B, version: 7, origin: REMOTE, selector: { exact: "The middle bit.", prefix: "Before it. ", suffix: " After it." } },
      { id: A, version: 2 },
      { id: B, version: 7, origin: REMOTE },
    ]);
  });

  it("a partial selector is checked against the version being baked", () => {
    const store = storeOf(item(A, { md: "Rewritten entirely.", version: 2 }));
    const result = bake(`![[${A}]]\n> Stigmergy is what a protocol looks like`, store, ctx);
    expect(result.errors).toMatchObject([{ code: "selection-not-found", message: "quoted passage not found in the target's version 2" }]);
  });

  it("a quote that welds two blocks does not match; one that spans them does", () => {
    const store = storeOf(item(A, { md: "Alpha line.\n\nBeta line." }));
    expect(bake(`![[${A}]]\n> Alpha line. Beta line.`, store, ctx).errors).toHaveLength(1);
    expect(bake(`![[${A}]]\n> Alpha line.\n>\n> Beta line.`, store, ctx).errors).toEqual([]);
  });

  it("a blank line detaches the blockquote, so the whole item is baked and the quote stays the author's", () => {
    const store = storeOf(item(A, { md: "Whole.\n\nItem." }));
    const result = bake(`![[${A}]]\n\n> My own pull-quote.\n`, store, ctx);
    expect(result.transclusions).toEqual([{ id: A, version: 1, origin: REMOTE }]);
    expect(result.html).not.toContain("blyg-partial");
    expect(result.html).toContain("<p>Item.</p>");
    expect(result.html).toContain("<blockquote>\n<p>My own pull-quote.</p>\n</blockquote>");
  });

  it("lazy continuation belongs to the selection", () => {
    const store = storeOf(item(A, { md: "first line lazy second line" }));
    expect(bake(`![[${A}]]\n> first line\nlazy second line\n`, store, ctx).errors).toEqual([]);
  });
});

describe("publish errors, by block", () => {
  it("reports each failure against the block that caused it", () => {
    const store = storeOf(item(A, { origin: REMOTE }), item(A, { origin: OTHER }));
    const result = bake(`Prose.\n\n![[${A}]]\n\n![[${id(5)}]]\n\n![[${B}@v2]]\n\n![[${ctx.draftId}]]\n`, store, ctx);
    expect(result.errors.map((e) => [e.block, e.code])).toEqual([
      [1, "ambiguous"],
      [2, "unknown"],
      [3, "reserved"],
      [4, "self"],
    ]);
    expect(result.html).not.toContain("blockquote");
    expect(result.transclusions).toEqual([]);
  });

  it("an empty blockquote is an error, not a zero-length selection", () => {
    const store = storeOf(item(A));
    expect(bake(`![[${A}]]\n>\n>\n`, store, ctx).errors).toMatchObject([{ code: "empty-selection" }]);
  });
});

describe("[[id]] links (§10.1, §10.3a)", () => {
  const doc = item(A, { origin: REMOTE, md: "# A heading\n\nBody.", page: "t/custom/" });

  it("renders an anchor to the target's absolute page and records links[]", () => {
    const result = bake(`See [[${A}]] now.\n`, storeOf(doc), ctx);
    expect(result.html).toBe(`<p>See <a href="${REMOTE}t/custom/">A heading</a> now.</p>\n`);
    expect(result.links).toEqual([{ id: A, origin: REMOTE }]);
    expect(result.transclusions).toEqual([]);
  });

  it("uses the author's label as anchor text, escaped", () => {
    const result = bake(`See [[${A} | the "claim" & co]].\n`, storeOf(doc), ctx);
    expect(result.html).toContain('>the &quot;claim&quot; &amp; co</a>');
  });

  it("without a label or a heading, a short quoted excerpt", () => {
    const plain = item(A, { md: "Just some words here." });
    expect(bake(`[[${A}]]`, storeOf(plain), ctx).html).toContain("“Just some words here.”</a>");
  });

  it("falls back to the reference page convention, absolute", () => {
    const thread = item(A, { kind: "thread", md: "Words." });
    expect(bake(`[[${A}]]`, storeOf(thread), ctx).html).toContain(`href="${REMOTE}t/${A}/"`);
  });

  it("omits origin for an own-origin link", () => {
    const local = item(A, { origin: DRAFT_ORIGIN });
    expect(bake(`[[${A}]]`, storeOf(local), ctx).links).toEqual([{ id: A }]);
  });

  it("an unresolvable link is a publish error", () => {
    const result = bake(`See [[${id(77)}]].\n`, storeOf(), ctx);
    expect(result.errors).toMatchObject([{ block: 0, code: "unknown", id: id(77) }]);
  });

  it("is inert in code spans and code blocks", () => {
    const result = bake("`[[" + A + "]]`\n\n```\n[[" + A + "]]\n```\n", storeOf(doc), ctx);
    expect(result.links).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.html).toContain(`<code>[[${A}]]</code>`);
  });

  it("an inline ![[id]] is literal text, neither a link nor a quote", () => {
    const result = bake(`see ![[${A}]] here\n`, storeOf(doc), ctx);
    expect(result.links).toEqual([]);
    expect(result.transclusions).toEqual([]);
    expect(result.html).toBe(`<p>see ![[${A}]] here</p>\n`);
  });

  it("inside another link it is just the words, and outside a code span an anchor still renders", () => {
    const result = bake(`[see [[${A} | this]]](https://e.test/) and [[${A} | that]]\n`, storeOf(doc), ctx);
    expect(result.html).toBe(`<p><a href="https://e.test/">see this</a> and <a href="${REMOTE}t/custom/">that</a></p>\n`);
    expect(result.links).toHaveLength(2);
  });

  it("is not a transclusion: no wrapper, and the markdown link form is silent", () => {
    const result = bake(`[quiet](${REMOTE}t/custom/)\n`, storeOf(doc), ctx);
    expect(result.links).toEqual([]);
    expect(result.html).toBe(`<p><a href="${REMOTE}t/custom/">quiet</a></p>\n`);
  });
});

describe("prose", () => {
  it("renders the same bytes whether blocks are rendered together or apart", () => {
    const md = "# Title\n\nA para with a [ref][r].\n\n- a\n- b\n\n[r]: https://e.test/\n";
    expect(bake(md, storeOf(), ctx).html).toBe(
      '<h1>Title</h1>\n<p>A para with a <a href="https://e.test/">ref</a>.</p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n',
    );
  });
});
