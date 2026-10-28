import { describe, expect, it } from "vitest";
import { commit, editProse, insertPartialQuote, insertWholeQuote, moveBlock, proseText, redo, removeBlock, startHistory, undo } from "./draft";
import { parse } from "./grammar";
import { id } from "./testing";

const A = id(1);
const B = id(2);
const kinds = (md: string) => parse(md).map((block) => block.kind);

describe("inserting quotes", () => {
  it("writes a whole quote as a directive line, separated so it cannot attach to what follows", () => {
    expect(insertWholeQuote("", 0, A)).toBe(`![[${A}]]\n`);
    expect(insertWholeQuote("First.\n\nSecond.\n", 1, A)).toBe(`First.\n\n![[${A}]]\n\nSecond.\n`);
    expect(insertWholeQuote("First.\n\nSecond.\n", 2, A)).toBe(`First.\n\nSecond.\n\n![[${A}]]\n`);
  });

  it("a whole quote inserted before the author's own blockquote does not become partial", () => {
    const md = insertWholeQuote("> my own quotation\n", 0, A);
    expect(kinds(md)).toEqual(["directive", "prose"]);
  });

  it("separates from a previous block that has no trailing newline", () => {
    expect(insertWholeQuote("no newline", 1, A)).toBe(`no newline\n\n![[${A}]]\n`);
  });

  it("writes a partial quote as a directive and an attached blockquote", () => {
    const md = insertPartialQuote("Intro.\n", 1, A, "Alpha beta.\nGamma.");
    expect(md).toBe(`Intro.\n\n![[${A}]]\n> Alpha beta.\n>\n> Gamma.\n`);
    expect(parse(md)[1]).toMatchObject({ kind: "partial", selection: "Alpha beta.\nGamma." });
  });

  it("escapes markdown in the selection so it round-trips", () => {
    const selection = "*not emphasis* and # not heading";
    expect(parse(insertPartialQuote("", 0, A, selection))[0]).toMatchObject({ kind: "partial", selection });
  });

  it("carries a label", () => {
    expect(insertWholeQuote("", 0, A, "the claim")).toBe(`![[${A} | the claim]]\n`);
    expect(insertPartialQuote("", 0, A, "x", "the claim")).toBe(`![[${A} | the claim]]\n> x\n`);
  });

  it("clamps a boundary outside the document", () => {
    expect(insertWholeQuote("Only.\n", 99, A)).toBe(`Only.\n\n![[${A}]]\n`);
    expect(insertWholeQuote("Only.\n", -3, A)).toBe(`![[${A}]]\n\nOnly.\n`);
  });

  it("keeps CRLF documents CRLF", () => {
    const md = insertPartialQuote("Intro.\r\n", 1, A, "x\ny");
    expect(md).toBe(`Intro.\r\n\r\n![[${A}]]\r\n> x\r\n>\r\n> y\r\n`);
  });
});

describe("moving and removing blocks", () => {
  const md = `One.\n\n![[${A}]]\n\nTwo.\n\n![[${B}]]\n> part\n`;

  it("moves a block to a boundary", () => {
    expect(parse(moveBlock(md, 3, 0)).map((b) => b.raw.trim())).toEqual([`![[${B}]]\n> part`, "One.", `![[${A}]]`, "Two."]);
    expect(parse(moveBlock(md, 0, 4)).map((b) => b.raw.trim())).toEqual([`![[${A}]]`, "Two.", `![[${B}]]\n> part`, "One."]);
  });

  it("a move to where the block already is changes nothing", () => {
    expect(moveBlock(md, 2, 2)).toBe(md);
    expect(moveBlock(md, 2, 3)).toBe(md);
  });

  it("moving the last block into the middle keeps it from fusing with its neighbours", () => {
    const moved = moveBlock(md, 3, 1);
    expect(kinds(moved)).toEqual(["prose", "partial", "directive", "prose"]);
    expect(parse(moved)[1]).toMatchObject({ selection: "part" });
  });

  it("removes a block", () => {
    expect(removeBlock(md, 1)).toBe(`One.\n\nTwo.\n\n![[${B}]]\n> part\n`);
    expect(removeBlock(md, 99)).toBe(md);
  });

  it("an operation never turns a quote into prose or the reverse", () => {
    const quotes = (text: string) => parse(text).filter((b) => b.kind !== "prose").length;
    let current = md;
    for (const step of [(m: string) => moveBlock(m, 0, 3), (m: string) => moveBlock(m, 2, 0), (m: string) => removeBlock(m, 1)]) {
      current = step(current);
    }
    expect(quotes(current)).toBe(1);
  });
});

describe("editing prose", () => {
  it("replaces a prose block and keeps its separator", () => {
    expect(editProse("One.\n\nTwo.\n", 0, "Uno.")).toBe("Uno.\n\nTwo.\n");
    expect(editProse("One.\n\nTwo.\n", 1, "Dos.")).toBe("One.\n\nDos.\n");
  });

  it("emptying a block removes it", () => {
    expect(editProse("One.\n\nTwo.\n", 0, "  ")).toBe("Two.\n");
  });

  it("leaves a directive alone", () => {
    const md = `![[${A}]]\n`;
    expect(editProse(md, 0, "x")).toBe(md);
  });

  it("shows a block without the blank lines that trail it", () => {
    expect(proseText("Para.\n\n")).toBe("Para.");
    expect(proseText("a\n\nb\r\n\r\n")).toBe("a\n\nb");
  });

  it("an edit that adds a directive line makes a directive on the next parse", () => {
    expect(kinds(editProse("One.\n\nTwo.\n", 0, `One.\n![[${A}]]`))).toEqual(["prose", "directive", "prose"]);
  });
});

describe("undo and redo", () => {
  it("steps back and forward, and a new edit forgets the future", () => {
    let history = startHistory("a");
    history = commit(history, "b");
    history = commit(history, "c");
    history = undo(history);
    expect(history.present).toBe("b");
    history = undo(history);
    expect(history.present).toBe("a");
    expect(undo(history)).toBe(history);
    history = redo(history);
    expect(history.present).toBe("b");
    history = commit(history, "x");
    expect(history.future).toEqual([]);
    expect(redo(history)).toBe(history);
  });

  it("a no-op edit records nothing", () => {
    const history = startHistory("a");
    expect(commit(history, "a")).toBe(history);
  });

  it("caps its depth", () => {
    let history = startHistory("0");
    for (let i = 1; i <= 300; i++) history = commit(history, String(i));
    expect(history.past).toHaveLength(200);
  });
});
