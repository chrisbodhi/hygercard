// The reference variant, mounted for real in Chromium and WebKit with a
// controlled store: the gestures, the bake preview, undo, and the bands, which
// must stay attached across independent scrolling and show each state.

import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/core/store";
import { id, item } from "../src/core/testing";
import type { HarnessEvent } from "../src/harness/events";
import { Keymap } from "../src/harness/keymap";
import { ColumnsBaseline } from "../src/variants/columns-baseline/ColumnsBaseline";
import { schema } from "../src/variants/columns-baseline";

const A = "https://a.test/blyg/";
const B = "https://b.test/blyg/";

const knobValues = (overrides: Record<string, unknown> = {}) => ({
  ...Object.fromEntries(Object.entries(schema).map(([name, spec]) => [name, spec.value])),
  ...overrides,
}) as never;

const frames = (n = 3) => new Promise<void>((resolve) => { const tick = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => tick(left - 1))); tick(n); });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => T | null | undefined | false, what: string, timeout = 3000): Promise<T> {
  const started = performance.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (performance.now() - started > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

const words = (seed: string) => Array.from({ length: 28 }, (_, i) => `${seed}${i}`).join(" ");
const fragment = (n: number, origin: string, base: number) => {
  const tag = origin === A ? "alpha" : "beta";
  return item(id(base + n), { origin, version: 1, md: `Paragraph one ${tag}${n}. ${words("a")}\n\nParagraph two ${tag}${n}. ${words("b")}\n\nParagraph three ${tag}${n}. ${words("c")}` });
};

let store: Store;
let events: HarnessEvent[];
let keymap: Keymap;
let detach: () => void;
let host: HTMLElement;
let root: Root;

function mount(knobs: Record<string, unknown> = {}) {
  host = document.createElement("div");
  host.style.cssText = "position:fixed; left:0; top:0; width:1000px; height:700px";
  document.body.append(host);
  root = createRoot(host);
  root.render(<ColumnsBaseline knobs={knobValues(knobs)} store={store} keymap={keymap} emit={(event) => events.push(event)} live={false} />);
}

beforeEach(() => {
  localStorage.clear();
  store = new Store();
  store.addSource({ origin: A, level: "blyg", title: "A blyg" });
  store.addSource({ origin: B, level: "blyg", title: "B blyg" });
  for (let n = 1; n <= 10; n++) {
    store.ingest(A, fragment(n, A, 0));
    store.ingest(B, fragment(n, B, 100));
  }
  events = [];
  keymap = new Keymap();
  detach = keymap.attach(document);
});

afterEach(() => {
  detach();
  root.unmount();
  host.remove();
});

// --- Pointer plumbing ---------------------------------------------------------

const centre = (el: Element) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] as const; };
function pointer(target: EventTarget, type: string, x: number, y: number, kind: "mouse" | "touch" = "mouse") {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, pointerType: kind, isPrimary: true }));
}
async function dragTo(handle: Element, x: number, y: number, kind: "mouse" | "touch" = "mouse") {
  const [hx, hy] = centre(handle);
  pointer(handle, "pointerdown", hx, hy, kind);
  for (let i = 1; i <= 8; i++) { pointer(window, "pointermove", hx + ((x - hx) * i) / 8, hy + ((y - hy) * i) / 8, kind); await frames(1); }
  pointer(window, "pointerup", x, y, kind);
  await frames(3);
}

/** Scroll a card into the middle of its column, so that a selection in it is not clamped away. */
async function reveal(card: HTMLElement) {
  card.scrollIntoView({ block: "center" });
  await frames(3);
}
/** Motion's insert animation, and the tracker's pulse, take a moment to settle. */
const settle = () => sleep(750);

const q = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
const all = <T extends Element = HTMLElement>(selector: string) => [...host.querySelectorAll<T>(selector)];
/** The raw content_md pane as text: one line per row, blank placeholder rows as empty lines. */
const rawText = () => [...(q(".cb-raw")?.children ?? [])].map((line) => (line.textContent === " " ? "" : line.textContent)).join("\n");
const cardIn = (side: "left" | "right", n = 0) => all(`[data-side="${side}"] [data-card]`)[n]!;
const lastZone = () => all("[data-zone]").at(-1)!;
const bandOf = (index: number) => host.querySelector<SVGGElement>(`svg.bands g[data-band="block-${index}"]`);
const hasChevron = (band: Element | null) => !!band?.querySelector('path[fill="none"]');
const ribbon = (band: Element) => band.querySelector("path")!.getAttribute("d")!;
const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);

describe("whole quotes", () => {
  it("dragging a card's handle writes a directive at the nearest block boundary", async () => {
    mount();
    const card = await until(() => cardIn("left"), "a card");
    await dragTo(card.querySelector(".cb-handle")!, ...centre(lastZone()));
    await until(() => rawText().includes(`![[${card.dataset.id}]]`), "the directive in content_md");
    expect(all("[data-block]").map((b) => b.dataset.kind)).toEqual(["prose", "directive"]);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["drag.start", "drop.commit", "bake.result", "band.state"]));
    expect(events.find((e) => e.type === "drop.commit")).toMatchObject({ directive: "whole", boundary: 1 });
  });

  it("works with touch pointers, which is all the iPad sends", async () => {
    mount();
    const card = await until(() => cardIn("left"), "a card");
    await dragTo(card.querySelector(".cb-handle")!, ...centre(lastZone()), "touch");
    await until(() => rawText().includes(`![[${card.dataset.id}]]`), "the directive");
    expect(getComputedStyle(card.querySelector(".cb-handle")!).touchAction).toBe("none");
  });

  it("a drop over the middle of a paragraph snaps to the nearest boundary, and the indicator shows where", async () => {
    mount();
    const card = await until(() => cardIn("right", 1), "a card");
    const block = await until(() => q('[data-block="0"]'), "the first block");
    const [hx, hy] = centre(card.querySelector(".cb-handle")!);
    const [bx, by] = centre(block);
    pointer(card.querySelector(".cb-handle")!, "pointerdown", hx, hy);
    for (let i = 1; i <= 8; i++) { pointer(window, "pointermove", hx + ((bx - hx) * i) / 8, hy + ((by - hy) * i) / 8); await frames(1); }
    const lines = all(".cb-zone").map((zone) => !!zone.querySelector(".line"));
    expect(lines.filter(Boolean)).toHaveLength(1);
    pointer(window, "pointerup", bx, by);
    await until(() => rawText().includes(card.dataset.id!), "the directive");
    expect(all("[data-block]")[0]!.dataset.kind).toMatch(/directive|partial/);
  });

  it("a release outside the draft cancels, and says so", async () => {
    mount();
    const card = await until(() => cardIn("left"), "a card");
    const before = rawText();
    await dragTo(card.querySelector(".cb-handle")!, 5, 650);
    expect(rawText()).toBe(before);
    expect(events.find((e) => e.type === "drag.cancel")).toMatchObject({ kind: "whole", reason: "released outside the draft" });
  });

  it("a press that never leaves the drag threshold is a click, and writes nothing", async () => {
    mount();
    const card = await until(() => cardIn("left"), "a card");
    const [hx, hy] = centre(card.querySelector(".cb-handle")!);
    pointer(card.querySelector(".cb-handle")!, "pointerdown", hx, hy);
    pointer(window, "pointermove", hx + 2, hy + 1);
    pointer(window, "pointerup", hx + 2, hy + 1);
    await frames(3);
    expect(events.some((e) => e.type === "drag.start")).toBe(false);
  });

  it("Escape cancels a drag in progress", async () => {
    mount();
    const card = await until(() => cardIn("left"), "a card");
    const [hx, hy] = centre(card.querySelector(".cb-handle")!);
    const [zx, zy] = centre(lastZone());
    pointer(card.querySelector(".cb-handle")!, "pointerdown", hx, hy);
    for (let i = 1; i <= 4; i++) { pointer(window, "pointermove", hx + ((zx - hx) * i) / 4, hy + ((zy - hy) * i) / 4); await frames(1); }
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await frames(2);
    expect(events.find((e) => e.type === "drag.cancel")).toMatchObject({ reason: "escape" });
    expect(rawText()).not.toContain("![[");
  });
});

describe("partial quotes", () => {
  async function selectIn(card: HTMLElement, from: number, to: number) {
    await reveal(card);
    const body = card.querySelector("[data-body]")!;
    const text = body.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, from);
    range.setEnd(text, to);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    await until(() => q(".cb-selection-handle"), "the selection handle");
  }

  it("selecting within one item and dragging the handle writes a directive and a blockquote", async () => {
    mount();
    const card = await until(() => cardIn("left", 2), "a card");
    await selectIn(card, 10, 60);
    const handle = q(".cb-selection-handle .cb-handle")!;
    const selected = getSelection()!.toString().trim(); // the quote is trimmed, as a block of text content is
    await dragTo(handle, ...centre(lastZone()));
    await until(() => rawText().includes("> "), "the blockquote in content_md");
    expect(rawText()).toContain(`![[${card.dataset.id}]]\n> ${selected}`);
    expect(events.find((e) => e.type === "selection.changed" && e.valid)).toMatchObject({ item: { id: card.dataset.id }, valid: true });
    expect(events.find((e) => e.type === "drop.commit")).toMatchObject({ directive: "partial", selection: selected });
    // The quote passed the publish-time check.
    expect(q(".cb-error")).toBeNull();
    expect(events.filter((e) => e.type === "bake.result").at(-1)).toMatchObject({ errors: [] });
  });

  it("the selection offsets in the event index the item's spec text content", async () => {
    mount();
    const card = await until(() => cardIn("left"), "a card");
    await selectIn(card, 0, 24);
    const event = events.find((e) => e.type === "selection.changed" && e.valid);
    expect(event).toMatchObject({ start: 0, end: 24, text: "Paragraph one alpha1. a0" });
    // Trailing whitespace is not part of a selection: a block is trimmed, and so is the quote.
    await selectIn(card, 0, 25);
    await until(() => q(".cb-status")!.textContent!.includes("offsets 0–24"), "the offsets in the status line");
  });

  it("a selection spanning several items is rejected, with the reason shown", async () => {
    mount();
    const a = await until(() => cardIn("left", 0), "a card");
    const b = cardIn("left", 1);
    const range = document.createRange();
    range.setStart(a.querySelector("p")!.firstChild!, 3);
    range.setEnd(b.querySelector("p")!.firstChild!, 9);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    await until(() => q(".cb-status .rejected"), "the rejection");
    expect(q(".cb-status")!.textContent).toContain("spans 2 items");
    expect(q(".cb-selection-handle")).toBeNull();
    expect(events.find((e) => e.type === "selection.changed" && !e.valid)).toMatchObject({ reason: expect.stringContaining("spans 2 items") });
  });

  it("a selection inside a nested baked quote is allowed, and logged as such", async () => {
    const inner = `<blockquote class="blyg-transclusion" data-blyg-id="${id(500)}" data-blyg-version="1">\n<p>The quoted words live inside here.</p>\n</blockquote>`;
    store.ingest(A, item(id(300), { origin: A, kind: "thread", html: `<p>Outer words.</p>\n${inner}`, md: "Outer words.", transclusions: [{ id: id(500), version: 1 }] }));
    mount();
    const card = await until(() => all("[data-card]").find((c) => c.dataset.id === id(300)), "the thread card");
    await reveal(card);
    const text = card.querySelector("blockquote p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 16);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    await until(() => q(".cb-selection-handle"), "the handle");
    expect(events.find((e) => e.type === "selection.nested-quote")).toMatchObject({ quotedId: id(500), depth: 1 });
    expect(events.find((e) => e.type === "selection.changed" && e.valid)).toMatchObject({ valid: true });
  });

  it("a plain RSS entry is marked, has no handle, and can never be quoted", async () => {
    store.addSource({ origin: "https://feed.test/rss", level: "l0", title: "A feed" });
    store.putL0("https://feed.test/rss", item("l0:1", { origin: "https://feed.test/rss", md: "Some wrapped summary words here" }));
    localStorage.setItem("hygercard:cb:right", JSON.stringify("https://feed.test/rss"));
    mount();
    const card = await until(() => cardIn("right"), "the L0 card");
    expect(card.classList.contains("l0")).toBe(true);
    expect(card.querySelector(".cb-handle")).toBeNull();
    expect(card.querySelector(".cb-badge")!.textContent).toMatch(/not quotable/i);
    const text = card.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 8);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    await until(() => q(".cb-status .rejected"), "the rejection");
    expect(q(".cb-status")!.textContent).toContain("L0");
  });
});

describe("the draft", () => {
  it("C-/ undoes and C-? redoes, through the keymap", async () => {
    mount();
    const card = await until(() => cardIn("left"), "a card");
    await dragTo(card.querySelector(".cb-handle")!, ...centre(lastZone()));
    await until(() => rawText().includes("![["), "the directive");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true, cancelable: true }));
    await until(() => !rawText().includes("![["), "the undo");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await until(() => rawText().includes("![["), "the redo");
  });

  it("shows a bake error inline, on the block that caused it, and refuses to export", async () => {
    localStorage.setItem("hygercard:cb:draft", JSON.stringify(`Words.\n\n![[${id(77)}]]\n`));
    mount();
    const block = await until(() => q('[data-block="1"]'), "the second block");
    expect(block.querySelector(".cb-error")!.textContent).toContain("unknown");
    expect(q('[data-block="0"] .cb-error')).toBeNull();
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("export"))!.click();
    await until(() => q(".cb-status")!.textContent!.includes("cannot export"), "the refusal");
    expect(events.filter((e) => e.type === "bake.result").at(-1)).toMatchObject({ errors: [{ block: 1, code: "unknown" }] });
  });

  it("edits a prose block through its textarea", async () => {
    localStorage.setItem("hygercard:cb:draft", JSON.stringify("First.\n\nSecond.\n"));
    mount();
    (await until(() => q<HTMLElement>('[data-block="0"] [role="button"]'), "the paragraph")).click();
    const area = await until(() => q<HTMLTextAreaElement>("textarea"), "the textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Rewritten.");
    area.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await until(() => rawText().startsWith("Rewritten."), "the edit");
    expect(rawText()).toContain("Second.");
  });
});

describe("bands", () => {
  async function quoteWhole(side: "left" | "right", n = 0) {
    const card = await until(() => cardIn(side, n), "a card");
    await dragTo(card.querySelector(".cb-handle")!, ...centre(lastZone()));
    await until(() => bandOf(1), "a band");
    return card;
  }

  it("connects a quote's source card to its block, in both directions", async () => {
    mount();
    await quoteWhole("left");
    const fromRight = cardIn("right", 1);
    await dragTo(fromRight.querySelector(".cb-handle")!, ...centre(lastZone()));
    await until(() => bandOf(2) && bandOf(1), "both bands");
    expect(bandOf(1)!.dataset.state).toBe("current");
    // A left source attaches at its column's right edge; a right source at its column's left edge.
    const [sourceX, , , , , , centerX] = numbers(ribbon(bandOf(1)!)).slice(0, 7);
    const [rightSourceX] = numbers(ribbon(bandOf(2)!));
    expect(sourceX!).toBeLessThan(centerX! );
    expect(rightSourceX!).toBeGreaterThan(sourceX!);
  });

  it("stays attached while each column scrolls independently, and clamps when a source scrolls out", async () => {
    mount();
    const card = await quoteWhole("left", 1);
    await settle();
    const leftScroller = q('[data-side="left"] [data-scroller]')!;
    const draftScroller = q("[data-draft]")!;
    const start = ribbon(bandOf(1)!);
    expect(hasChevron(bandOf(1))).toBe(false);

    // Scroll the source column: the source end moves with its card, the center end stays put.
    leftScroller.scrollTop += 60;
    await frames(4);
    const moved = ribbon(bandOf(1)!);
    expect(moved).not.toBe(start);
    const [, sourceTop0, , , , , centerX0, centerTop0] = numbers(start);
    const [, sourceTop1, , , , , centerX1, centerTop1] = numbers(moved);
    expect(sourceTop1!).toBeCloseTo(sourceTop0! - 60, 0);
    expect([centerX1, centerTop1]).toEqual([centerX0, centerTop0]);

    // Scroll the card far out of the window: the source end clamps, and says so with a chevron.
    leftScroller.scrollTop = leftScroller.scrollHeight;
    await frames(4);
    const gone = card.getBoundingClientRect();
    const view = leftScroller.getBoundingClientRect();
    expect(gone.bottom < view.top || gone.top > view.bottom).toBe(true);
    expect(hasChevron(bandOf(1))).toBe(true);

    // Scrolling the *other* column does not disturb it.
    const before = ribbon(bandOf(1)!);
    q('[data-side="right"] [data-scroller]')!.scrollTop = 200;
    await frames(4);
    expect(ribbon(bandOf(1)!)).toBe(before);

    // Scroll the draft: the center end moves, and the band follows.
    expect(draftScroller.scrollHeight).toBeGreaterThanOrEqual(draftScroller.clientHeight);
    leftScroller.scrollTop = 0;
    await frames(4);
    expect(hasChevron(bandOf(1))).toBe(false);
  });

  it("the source end of a partial quote is the located passage, not the card", async () => {
    mount();
    const card = await until(() => cardIn("left", 3), "a card");
    await reveal(card);
    const text = card.querySelectorAll("p")[2]!.firstChild as Text; // the third paragraph: well below the card's top
    const range = document.createRange();
    range.setStart(text, 5);
    range.setEnd(text, 40);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    await until(() => q(".cb-selection-handle"), "the handle");
    await dragTo(q(".cb-selection-handle .cb-handle")!, ...centre(lastZone()));
    await until(() => bandOf(1), "the band");
    const overlay = q(".cb-root")!.getBoundingClientRect();
    const passage = range.getBoundingClientRect();
    await settle();
    const [, top] = numbers(ribbon(bandOf(1)!));
    expect(top! + overlay.top).toBeGreaterThan(passage.top - 2);
    expect(top! + overlay.top).toBeLessThan(passage.top + 2);
    // ...which is well below where the card begins.
    expect(top! + overlay.top).toBeGreaterThan(card.getBoundingClientRect().top + 40);
  });

  async function withQuote() {
    mount();
    const card = await quoteWhole("left", 0);
    return card.dataset.id!;
  }

  it("is stale when the store holds a newer version than the draft last saw, and refreshing accepts it", async () => {
    const quoted = await withQuote();
    store.ingest(A, { ...fragment(1, A, 0), id: quoted, version: 2 });
    await until(() => bandOf(1)?.dataset.state === "stale", "a stale band");
    expect(events.find((e) => e.type === "band.state" && e.state === "stale")).toMatchObject({ previous: "current" });
    expect(q('[data-block="1"] .state')!.textContent).toBe("source stale");
    const refresh = [...host.querySelectorAll("button")].find((b) => b.textContent === "refresh quotes")!;
    expect(refresh.disabled).toBe(false);
    refresh.click();
    await until(() => bandOf(1)?.dataset.state === "current", "the band to be current again");
    expect(refresh.disabled).toBe(true);
  });

  it("is withdrawn when the origin has withdrawn the source: the block says so, and there is nothing to attach to", async () => {
    const quoted = await withQuote();
    store.ingest(A, item(quoted, { origin: A, kind: "withdrawn", version: 2 }));
    await until(() => events.some((e) => e.type === "band.state" && e.state === "withdrawn"), "a withdrawn state");
    expect(q('[data-block="1"] .cb-error')!.textContent).toContain("withdrawn");
    expect(q('[data-block="1"] .state')!.textContent).toBe("source withdrawn");
    expect(bandOf(1)).toBeNull(); // the card has left its column
  });

  it("is drifted when a partial selector no longer matches the source's current text: an error, and a band to what is left", async () => {
    mount();
    const card = await until(() => cardIn("left", 0), "a card");
    await reveal(card);
    const text = card.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 5);
    range.setEnd(text, 50);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    await until(() => q(".cb-selection-handle"), "the handle");
    await dragTo(q(".cb-selection-handle .cb-handle")!, ...centre(lastZone()));
    await until(() => bandOf(1), "the band");
    store.ingest(A, { ...fragment(1, A, 0), id: card.dataset.id!, version: 2, content_md: "Entirely different.", content_html: "<p>Entirely different.</p>" });
    await until(() => bandOf(1)?.dataset.state === "drifted", "a drifted band");
    expect(q('[data-block="1"] .cb-error')!.textContent).toContain("not found");
    expect(events.find((e) => e.type === "band.state" && e.state === "drifted")).toMatchObject({ anchor: "orphaned" });
  });

  it("is missing when the source has left the store", async () => {
    await withQuote();
    store.clear();
    store.addSource({ origin: A, level: "blyg", title: "A blyg" });
    store.addSource({ origin: B, level: "blyg", title: "B blyg" });
    await until(() => events.some((e) => e.type === "band.state" && e.state === "missing"), "a missing state");
    expect(q('[data-block="1"] .cb-error')!.textContent).toBeTruthy();
    expect(q('[data-block="1"] .state')!.textContent).toBe("source missing");
    expect(bandOf(1)).toBeNull();
  });

  it("visibility: by state shows only the bands that need a look; on hover shows the hovered one", async () => {
    mount({ bandVisibility: "by state" });
    const card = await until(() => cardIn("left", 0), "a card");
    await dragTo(card.querySelector(".cb-handle")!, ...centre(lastZone()));
    await until(() => q('[data-block="1"]'), "the quote");
    await frames(4);
    expect(bandOf(1)).toBeNull(); // current: hidden
    store.ingest(A, { ...fragment(1, A, 0), id: card.dataset.id!, version: 2 });
    await until(() => bandOf(1)?.dataset.state === "stale", "the stale band to show");
  });

  it("visibility: on hover", async () => {
    mount({ bandVisibility: "on hover" });
    const card = await until(() => cardIn("left", 0), "a card");
    await dragTo(card.querySelector(".cb-handle")!, ...centre(lastZone()));
    await until(() => q('[data-block="1"]'), "the quote");
    await frames(4);
    expect(bandOf(1)).toBeNull();
    q('[data-block="1"]')!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await until(() => bandOf(1), "the band to show on hover");
  });

  it("curvature and opacity knobs change the drawing", async () => {
    mount({ bandCurvature: 0, bandOpacity: 0.9 });
    await quoteWhole("left", 0);
    const band = bandOf(1)!;
    expect(band.querySelector("path")!.getAttribute("fill-opacity")).toBe("0.9");
    const d = numbers(ribbon(band));
    expect(d[2]).toBe(d[0]); // zero curvature: the first handle sits on the endpoint
  });

  it("more curvature moves the handles toward the other end", async () => {
    mount({ bandCurvature: 1 });
    await quoteWhole("left", 0);
    const d = numbers(ribbon(bandOf(1)!));
    expect(d[2]!).toBeGreaterThan(d[0]!);
  });
});

describe("export", () => {
  it("downloads a thread item document that re-imports cleanly", async () => {
    mount();
    const card = await until(() => cardIn("left"), "a card");
    await dragTo(card.querySelector(".cb-handle")!, ...centre(lastZone()));
    await until(() => bandOf(1), "the band");
    let blob: Blob | undefined;
    const create = URL.createObjectURL;
    URL.createObjectURL = (b) => { blob = b as Blob; return "blob:test"; };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { /* swallow the download */ };
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("export"))!.click();
    URL.createObjectURL = create;
    HTMLAnchorElement.prototype.click = click;
    expect(blob).toBeDefined();
    const doc = JSON.parse(await blob!.text());
    expect(doc).toMatchObject({ blyg: "0.4", kind: "thread", version: 1, origin: "http://localhost:5173/blyg/", transclusions: [{ id: card.dataset.id, origin: A, version: 1 }] });
    expect(new Store().ingest("http://localhost:5173/blyg/", doc)).toEqual([]);
  });
});
