import { describe, expect, it } from "vitest";
import { layout, piecesOf, selectorFor, selectRaw, textContent, type Piece } from "./textContent";

describe("text content (§10.2)", () => {
  it("strips tags, collapses whitespace inside a block, breaks between blocks", () => {
    expect(textContent("<p>Alpha   beta\n gamma</p>\n<p>Delta</p>\n")).toBe("Alpha beta gamma\nDelta");
  });

  it("keeps the block boundary, so a quote that welds two blocks does not match", () => {
    const text = textContent("<p>Alpha line.</p><p>Beta line.</p>");
    expect(text.includes("Alpha line.\nBeta line.")).toBe(true);
    expect(text.includes("Alpha line. Beta line.")).toBe(false);
  });

  it("is independent of where the author soft-wrapped the source", () => {
    expect(textContent("<p>one\ntwo three</p>")).toBe(textContent("<p>one two\nthree</p>"));
  });

  it("drops empty blocks", () => {
    expect(textContent("<p>a</p><p></p><p> </p><p>b</p>")).toBe("a\nb");
  });

  it("treats <br> and the end of li, h1-h6, pre, div, tr, section, article as boundaries", () => {
    expect(textContent("a<br>b")).toBe("a\nb");
    expect(textContent("<ul><li>one</li><li>two</li></ul>")).toBe("one\ntwo");
    expect(textContent("<h2>Head</h2>text")).toBe("Head\ntext");
    expect(textContent("<pre>x\n  y</pre><div>z</div>")).toBe("x y\nz");
    expect(textContent("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>")).toBe("ab\nc");
  });

  it("decodes entities, numeric ones included", () => {
    expect(textContent("<p>Tom &amp; Jerry &lt;3 it&#8217;s &#x2014; a&nbsp;b</p>")).toBe("Tom & Jerry <3 it’s — a b");
  });

  it("ignores script and style, and stays inside a nested blockquote", () => {
    expect(textContent("<p>a<script>alert(1)</script><style>p{}</style>b</p>")).toBe("ab");
    expect(textContent('<blockquote class="blyg-transclusion"><p>inner</p></blockquote><p>outer</p>')).toBe("inner\nouter");
  });

  it("does not let tag attributes leak into the text", () => {
    expect(textContent('<p><a href="https://x.test/?a=1&amp;b=2" title="1 > 0">link</a> text</p>')).toBe("link text");
  });
});

describe("selectorFor", () => {
  it("records short context from the first match", () => {
    const text = "Before it. The middle bit. After it.";
    expect(selectorFor(text, "The middle bit.")).toEqual({
      exact: "The middle bit.",
      prefix: "Before it. ",
      suffix: " After it.",
    });
  });

  it("omits context there is none of, and caps it at 32 characters", () => {
    expect(selectorFor("Exactly this.", "Exactly this.")).toEqual({ exact: "Exactly this." });
    const long = "a".repeat(100) + "NEEDLE" + "b".repeat(100);
    const selector = selectorFor(long, "NEEDLE")!;
    expect(selector.prefix).toHaveLength(32);
    expect(selector.suffix).toHaveLength(32);
  });

  it("is null for a selection that is not there, or empty", () => {
    expect(selectorFor("abc", "abd")).toBeNull();
    expect(selectorFor("abc", "")).toBeNull();
  });
});

describe("selectRaw: raw characters to text-content offsets", () => {
  const html = "<p>Alpha   beta</p><p>  gamma delta  </p>";
  const pieces = piecesOf(html);
  const lay = layout(pieces);
  const raw = pieces.filter((p): p is string => p !== null).join("");

  it("maps a range inside one block", () => {
    const from = raw.indexOf("beta");
    const hit = selectRaw(lay, from, from + 4)!;
    expect(hit.exact).toBe("beta");
    expect(lay.text.slice(hit.start, hit.end)).toBe("beta");
  });

  it("maps a range across the collapsed whitespace run", () => {
    const from = raw.indexOf("Alpha");
    const hit = selectRaw(lay, from, raw.indexOf("beta") + 4)!;
    expect(hit.exact).toBe("Alpha beta");
  });

  it("maps a range across a block boundary, keeping the line break", () => {
    const hit = selectRaw(lay, raw.indexOf("beta"), raw.indexOf("gamma") + 5)!;
    expect(hit.exact).toBe("beta\ngamma");
  });

  it("trims whitespace at either edge, and refuses whitespace alone", () => {
    const hit = selectRaw(lay, raw.indexOf("Alpha") + 5, raw.indexOf("beta"))
    expect(hit).toBeNull();
    const padded = selectRaw(lay, raw.indexOf("gamma") - 2, raw.indexOf("delta") + 5 + 2)!;
    expect(padded.exact).toBe("gamma delta");
  });
});

// --- Agreement checks -------------------------------------------------------

/** An independent statement of the same rules, over strings, for inputs without numeric entities or scripts. */
function oracle(html: string): string {
  const decoded = html
    .replace(/<\/(?:p|h[1-6]|li|blockquote|pre|div|tr|section|article)>|<br\s*\/?>/gi, "\u0000")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return decoded
    .split("\u0000")
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block !== "")
    .join("\n");
}

function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

const WORDS = ["word", "two words", "café", "&amp;", "&lt;", "&nbsp;", "  ", "\n", "\t", " lead", "trail "];
const INLINE = ["em", "strong", "a", "span"];
const LEAVES = ["p", "h2", "pre", "li"];
const CONTAINERS = ["div", "blockquote", "section", "article"];

/** Well-formed HTML: the oracle states the rules for documents a parser need not repair. */
function randomHtml(next: () => number, depth = 0): string {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const inline = (): string => {
    let out = "";
    for (let n = Math.floor(next() * 4); n > 0; n--) {
      const roll = next();
      if (roll < 0.55) out += pick(WORDS);
      else if (roll < 0.7) out += "<br>";
      else { const tag = pick(INLINE); out += `<${tag}>${pick(WORDS)}${next() < 0.3 ? "<br/>" : ""}${pick(WORDS)}</${tag}>`; }
    }
    return out;
  };
  let html = "";
  for (let n = Math.floor(next() * 5); n > 0; n--) {
    const roll = next();
    if (roll < 0.25) html += inline();
    else if (roll < 0.7 || depth >= 2) { const tag = pick(LEAVES); html += `<${tag}>${inline()}</${tag}>`; }
    else { const tag = pick(CONTAINERS); html += `<${tag}>${randomHtml(next, depth + 1)}</${tag}>`; }
  }
  return html;
}

describe("agreement", () => {
  it("matches an independent statement of the rules on random HTML", () => {
    const next = prng(7);
    for (let i = 0; i < 400; i++) {
      const html = randomHtml(next);
      expect(textContent(html), html).toBe(oracle(html));
    }
  });

  it("a range's offsets give the same text as normalizing the cut-out sub-stream", () => {
    const next = prng(11);
    for (let i = 0; i < 300; i++) {
      const pieces: Piece[] = piecesOf(randomHtml(next));
      const lay = layout(pieces);
      const rawLength = lay.offsetOfRaw.length;
      if (rawLength < 2) continue;
      const a = Math.floor(next() * rawLength);
      const b = Math.floor(next() * rawLength);
      const [from, to] = a < b ? [a, b + 1] : [b, a + 1];
      const hit = selectRaw(lay, from, to);

      // Cut the stream at [from, to), keeping every boundary inside it.
      const sub: Piece[] = [];
      let seen = 0;
      for (const piece of pieces) {
        if (piece === null) { sub.push(null); continue; }
        const lo = Math.max(from - seen, 0);
        const hi = Math.min(to - seen, piece.length);
        if (hi > lo) sub.push(piece.slice(lo, hi));
        seen += piece.length;
      }
      const expected = layout(sub).text;
      expect(hit?.exact ?? "", JSON.stringify(pieces)).toBe(expected);
      if (hit) expect(lay.text.slice(hit.start, hit.end)).toBe(hit.exact);
    }
  });
});
