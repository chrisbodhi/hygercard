import { describe, expect, it } from "vitest";
import { directiveLine, parse, quoteFor, selectionOf, serialize, type Block } from "./grammar";

const A = "7c9wk2mhq0v3xj8tn5rzfd41bg";
const B = "1vgtgz0gq5b2c9k7d3m8r4n6xy";

const kinds = (md: string) => parse(md).map((block) => block.kind);
const only = (md: string): Block => {
  const blocks = parse(md);
  expect(blocks).toHaveLength(1);
  return blocks[0]!;
};

describe("directives (§10.1)", () => {
  it("a line that is solely ![[id]] is a directive, whitespace around it allowed", () => {
    expect(only(`![[${A}]]\n`)).toMatchObject({ kind: "directive", id: A, label: null });
    expect(only(`  ![[${A}]]  \n`)).toMatchObject({ kind: "directive", id: A });
    expect(only(`![[${A}]]`)).toMatchObject({ kind: "directive", id: A });
  });

  it("a line ends at LF or CRLF alike", () => {
    expect(only(`![[${A}]]\r\n`)).toMatchObject({ kind: "directive", id: A });
    expect(kinds(`intro\r\n\r\n![[${A}]]\r\n\r\noutro\r\n`)).toEqual(["prose", "directive", "prose"]);
  });

  it("carries a label, trimmed, which may itself contain a pipe", () => {
    expect(only(`![[${A} | the opening fragment]]`)).toMatchObject({ label: "the opening fragment" });
    expect(only(`![[${A}|tight]]`)).toMatchObject({ label: "tight" });
    expect(only(`![[${A} | a | b ]]`)).toMatchObject({ label: "a | b" });
    expect(only(`![[${A} |   ]]`)).toMatchObject({ kind: "directive", label: null });
  });

  it("is not a directive when the id is malformed or other text shares the line", () => {
    expect(kinds(`![[${A.slice(1)}]]`)).toEqual(["prose"]);
    expect(kinds(`![[${A.toUpperCase()}]]`)).toEqual(["prose"]);
    expect(kinds(`see ![[${A}]] here`)).toEqual(["prose"]);
    expect(kinds(`![[${A}]] ![[${B}]]`)).toEqual(["prose"]);
    expect(kinds(`- ![[${A}]]`)).toEqual(["prose"]);
    expect(kinds(`> ![[${A}]]`)).toEqual(["prose"]);
  });

  it("recognizes a directive in the middle of a paragraph: the grammar is line-based", () => {
    expect(kinds(`before\n![[${A}]]\nafter`)).toEqual(["prose", "directive", "prose"]);
  });

  it("splits adjacent directives", () => {
    expect(kinds(`![[${A}]]\n![[${B}]]\n`)).toEqual(["directive", "directive"]);
  });

  it("tolerates the reserved explicit-version form as its own construct", () => {
    expect(only(`![[${A}@v2]]`)).toMatchObject({ kind: "reserved", id: A, version: 2 });
    expect(kinds(`[[${A}@v2]]`)).toEqual(["prose"]);
  });
});

describe("partial directives (§10.1)", () => {
  it("a directive immediately followed by a blockquote is partial", () => {
    const block = only(`![[${A}]]\n> Stigmergy is what a protocol\n> looks like from inside.\n`);
    expect(block).toMatchObject({
      kind: "partial",
      id: A,
      selection: "Stigmergy is what a protocol looks like from inside.",
    });
  });

  it("a blank line detaches the blockquote", () => {
    expect(kinds(`![[${A}]]\n\n> the author's own quotation\n`)).toEqual(["directive", "prose"]);
  });

  it("includes lazy continuation lines in the selection", () => {
    const [partial, prose] = parse(`![[${A}]]\n> first line\nlazy second line\n\nCommentary.\n`);
    expect(partial).toMatchObject({ kind: "partial", selection: "first line lazy second line" });
    expect(prose).toMatchObject({ kind: "prose", raw: "Commentary.\n" });
  });

  it("ends the quote at a line CommonMark would not continue it with", () => {
    for (const breaker of ["# Heading", "- list item", "```", "---", "1. ordered"]) {
      const blocks = parse(`![[${A}]]\n> quoted\n${breaker}\n`);
      expect(blocks[0], breaker).toMatchObject({ kind: "partial", selection: "quoted" });
      expect(blocks[1]?.kind, breaker).toBe("prose");
    }
  });

  it("keeps a paragraph break inside the selection as a line break", () => {
    const block = only(`![[${A}]]\n> First paragraph.\n>\n> Second paragraph.\n`);
    expect(block).toMatchObject({ kind: "partial", selection: "First paragraph.\nSecond paragraph." });
  });

  it("carries a label on a partial too", () => {
    expect(only(`![[${A} | the claim]]\n> text\n`)).toMatchObject({ kind: "partial", label: "the claim", selection: "text" });
  });

  it("renders emphasis away: the selection is text", () => {
    expect(only(`![[${A}]]\n> the *thin* layer, **very** thin\n`)).toMatchObject({ selection: "the thin layer, very thin" });
  });

  it("an empty blockquote is still partial, with an empty selection, and does not swallow what follows", () => {
    const blocks = parse(`![[${A}]]\n>\n>\n\nAfter.\n`);
    expect(blocks[0]).toMatchObject({ kind: "partial", selection: "" });
    expect(blocks[1]).toMatchObject({ kind: "prose", raw: "After.\n" });
  });

  it("works with CRLF", () => {
    const block = only(`![[${A}]]\r\n> one\r\n> two\r\n\r\n`);
    expect(block).toMatchObject({ kind: "partial", selection: "one two" });
  });

  it("a directive inside the quote's lazy continuation belongs to the selection", () => {
    const blocks = parse(`![[${A}]]\n> quoted\n![[${B}]]\n`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "partial", selection: `quoted ![[${B}]]` });
  });
});

describe("inertness (§10.1)", () => {
  it("is inert inside fenced code, backtick or tilde, and indented code", () => {
    expect(kinds("```\n" + `![[${A}]]\n` + "```\n")).toEqual(["prose"]);
    expect(kinds("~~~\n" + `![[${A}]]\n` + "~~~\n")).toEqual(["prose"]);
    expect(kinds(`para\n\n    ![[${A}]]\n`)).toEqual(["prose", "prose"]);
  });

  it("is inert inside a code span, even one that runs across lines", () => {
    expect(kinds("text `\n" + `![[${A}]]\n` + "` more\n")).toEqual(["prose"]);
    expect(kinds("a ``\n" + `![[${A}]]\n` + "`` b\n")).toEqual(["prose"]);
  });

  it("is live again after the code ends", () => {
    expect(kinds("```\ncode\n```\n" + `![[${A}]]\n`)).toEqual(["prose", "directive"]);
  });

  it("a backslash-escaped backtick does not open a code span", () => {
    expect(kinds("a \\`\n" + `![[${A}]]\n` + "\\` b\n")).toEqual(["prose", "directive", "prose"]);
  });

  it("inline links are inert in code and found elsewhere", () => {
    const [prose] = parse(`see [[${A}]] and \`[[${B}]]\` and [[${B} | labelled]]\n`) as [Extract<Block, { kind: "prose" }>];
    expect(prose.links.map((link) => [link.id, link.label])).toEqual([[A, null], [B, "labelled"]]);
    for (const link of prose.links) expect(prose.raw.slice(link.start, link.end)).toMatch(/^\[\[/);
  });

  it("an inline [[id]] is a link, not a transclusion", () => {
    expect(kinds(`[[${A}]]\n`)).toEqual(["prose"]);
    expect(kinds(`a ![[${A}]]\n`)).toEqual(["prose"]);
  });
});

describe("prose blocks", () => {
  it("splits at top-level markdown blocks and keeps blank lines with the block before them", () => {
    const blocks = parse("# Title\n\nFirst para.\n\n- a\n- b\n\n```\ncode\n\nmore\n```\n");
    expect(blocks.map((b) => b.raw)).toEqual([
      "# Title\n\n",
      "First para.\n\n",
      "- a\n- b\n\n",
      "```\ncode\n\nmore\n```\n",
    ]);
  });

  it("keeps a blank-line-separated indented code run as one block", () => {
    expect(parse("    a\n\n    b\n")).toHaveLength(1);
  });

  it("the blank lines after a directive stay with the directive", () => {
    const blocks = parse(`![[${A}]]\n\n\nAfter\n`);
    expect(blocks.map((b) => b.raw)).toEqual([`![[${A}]]\n\n\n`, "After\n"]);
  });
});

describe("lossless round trip", () => {
  const cases = [
    "",
    "\n",
    "\n\n\n",
    "just prose",
    "trailing spaces   \n\n  \n",
    `![[${A}]]`,
    `![[${A}]]\n> q`,
    `![[${A}]]\r\n> q\r\n\r\nmixed\nendings\r\n`,
    "lone\rcarriage\rreturns\n",
    `a\r\rb ![[${A}]]\r`,
    `[ref]: http://x.test\n\n[text][ref]\n\n![[${A}]]\n`,
    "```\nunclosed fence " + `![[${A}]]\n`,
    "\u2028 odd \u0085 whitespace\n",
    "\ue000 private use \ue001\n",
  ];
  for (const md of cases) {
    it(JSON.stringify(md), () => expect(serialize(parse(md))).toBe(md));
  }

  it("holds for random documents built from grammar-shaped lines", () => {
    let seed = 42;
    const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
    const lines = [
      "", "", "prose line", "  indented", "    code-ish", "> quote", ">", "lazy", "# heading", "- item", "1. item", "```", "~~~", "---",
      `![[${A}]]`, `![[${B} | label]]`, `![[${A}@v2]]`, `see [[${B}]]`, "`tick", "`` ``", "[ref]: http://x.test", "\\", "\ufeffbom",
    ];
    const eols = ["\n", "\n", "\r\n", "\r"];
    for (let doc = 0; doc < 500; doc++) {
      let md = "";
      for (let n = Math.floor(next() * 14); n > 0; n--) {
        md += lines[Math.floor(next() * lines.length)]! + eols[Math.floor(next() * eols.length)]!;
      }
      if (next() < 0.3) md = md.slice(0, -1);
      expect(serialize(parse(md)), JSON.stringify(md)).toBe(md);
    }
  });
});

describe("writing the grammar", () => {
  it("formats directives, sanitizing a label so it cannot close the bracket", () => {
    expect(directiveLine(A)).toBe(`![[${A}]]`);
    expect(directiveLine(A, "nice")).toBe(`![[${A} | nice]]`);
    expect(directiveLine(A, "a ]] b")).toBe(`![[${A} | a ] ] b]]`);
    expect(directiveLine(A, "  multi\nline  ")).toBe(`![[${A} | multi line]]`);
    expect(parse(directiveLine(A, "a ]] b"))[0]).toMatchObject({ kind: "directive", label: "a ] ] b" });
  });

  it("writes a blockquote whose selection is exactly the text, whatever markdown it contains", () => {
    const tricky = [
      "plain sentence.",
      "two\nblocks",
      "*not emphasis* and _this_ and `code` and **bold**",
      "# not a heading",
      "- not a list",
      "1. not an ordered list",
      "> not a quote",
      "[not](a link) and ![img](x) and [[not-a-link]]",
      "<b>not html</b> & &amp; &#8217; entities",
      "a | b | c and ~~strike~~ and ***",
      "https://example.com/bare-url-stays-text",
      "trailing backslash\\",
      "---",
      "+ plus",
    ];
    for (const selection of tricky) {
      const quote = quoteFor(selection);
      expect(selectionOf(quote), JSON.stringify(selection)).toBe(selection);
      const block = parse(`![[${A}]]\n${quote}`)[0]!;
      expect(block).toMatchObject({ kind: "partial", selection });
    }
  });

  it("uses the document's line ending", () => {
    expect(quoteFor("a\nb", "\r\n")).toBe("> a\r\n>\r\n> b\r\n");
  });
});
