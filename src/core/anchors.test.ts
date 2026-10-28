import { describe, expect, it } from "vitest";
import { bandState, locate } from "./anchors";
import { id, item, REMOTE, storeOf, DRAFT_ORIGIN } from "./testing";
import { textContent } from "./textContent";

const A = id(1);
const text = "Stigmergy is what a protocol looks like from inside, and the reason it looks like nothing at all is the point.";

describe("locate (presentation only)", () => {
  it("finds a unique passage exactly", () => {
    const exact = "the reason it looks like nothing";
    const start = text.indexOf(exact);
    expect(locate(text, { exact })).toEqual({ kind: "exact", start, end: start + exact.length });
  });

  it("uses recorded context to choose between repeated passages", () => {
    const repeated = "alpha one. beta. gamma two. beta. delta three.";
    const second = locate(repeated, { exact: "beta.", prefix: "gamma two. ", suffix: " delta" });
    expect(second).toEqual({ kind: "exact", start: repeated.lastIndexOf("beta."), end: repeated.lastIndexOf("beta.") + 5 });
  });

  it("reports ambiguity when context cannot choose", () => {
    const repeated = "beta. and beta.";
    expect(locate(repeated, { exact: "beta." })).toMatchObject({ kind: "ambiguous", start: 0, candidates: 2 });
  });

  it("finds a passage that has been lightly edited, as fuzzy", () => {
    const edited = text.replace("looks like nothing at all", "looks like nothing whatsoever at all");
    const anchor = locate(edited, { exact: "the reason it looks like nothing at all is the point", prefix: "from inside, and " });
    expect(anchor.kind).toBe("fuzzy");
    if (anchor.kind === "fuzzy") {
      expect(edited.slice(anchor.start, anchor.end)).toContain("looks like nothing");
      expect(anchor.score).toBeGreaterThan(0.5);
    }
  });

  it("is orphaned when the passage is gone", () => {
    expect(locate("Rewritten entirely.", { exact: text })).toEqual({ kind: "orphaned" });
    expect(locate("anything", { exact: "" })).toEqual({ kind: "orphaned" });
  });

  it("handles a long passage past the matcher's pattern width", () => {
    const long = "x".repeat(10) + " " + "word ".repeat(40) + "tail";
    const edited = long.replace("word word", "word wurd");
    expect(locate(edited, { exact: long }).kind).toBe("fuzzy");
  });
});

describe("band state", () => {
  const entry = { id: A, version: 1, origin: REMOTE };

  it("current: the store holds the version the draft baked", () => {
    expect(bandState(entry, storeOf(item(A)), DRAFT_ORIGIN).state).toBe("current");
  });

  it("stale: the store holds a newer version", () => {
    expect(bandState(entry, storeOf(item(A, { version: 2 })), DRAFT_ORIGIN).state).toBe("stale");
  });

  it("withdrawn: the origin has withdrawn it", () => {
    expect(bandState(entry, storeOf(item(A, { kind: "withdrawn", version: 2 })), DRAFT_ORIGIN).state).toBe("withdrawn");
  });

  it("missing: the source is not in the store, or is an L0 row", () => {
    expect(bandState(entry, storeOf(), DRAFT_ORIGIN).state).toBe("missing");
  });

  it("drifted: a partial selector no longer matches the current text exactly", () => {
    const partial = { ...entry, selector: { exact: "Stigmergy is what a protocol looks like" } };
    expect(bandState(partial, storeOf(item(A, { md: "Stigmergy is what a protocol looks like from inside" })), DRAFT_ORIGIN).state).toBe("current");
    const drifted = bandState(partial, storeOf(item(A, { version: 2, md: "Something else now, entirely unrelated." })), DRAFT_ORIGIN);
    expect(drifted.state).toBe("drifted");
    expect(drifted.anchor?.kind).toBe("orphaned");
  });

  it("a newer version that still contains the passage is stale, not drifted, and carries the located range", () => {
    const partial = { ...entry, selector: { exact: "a protocol looks like" } };
    const reading = bandState(partial, storeOf(item(A, { version: 2, md: "Stigmergy is what a protocol looks like" })), DRAFT_ORIGIN);
    expect(reading.state).toBe("stale");
    expect(reading.anchor).toMatchObject({ kind: "exact" });
    const html = reading.item!.doc.content_html;
    if (reading.anchor?.kind === "exact") expect(textContent(html).slice(reading.anchor.start, reading.anchor.end)).toBe("a protocol looks like");
  });

  it("an entry without an origin means the draft's own", () => {
    expect(bandState({ id: A, version: 1 }, storeOf(item(A, { origin: DRAFT_ORIGIN })), DRAFT_ORIGIN).state).toBe("current");
  });
});
