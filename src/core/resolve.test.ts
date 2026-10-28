import { describe, expect, it } from "vitest";
import { resolve } from "./resolve";
import { Store } from "./store";
import { DRAFT_ORIGIN, id, item, OTHER, REMOTE, storeOf } from "./testing";

const ctx = { origin: DRAFT_ORIGIN, draftId: id(999) };
const A = id(1);

const failure = (store: Store, target: string, context = ctx) => {
  const result = resolve(store, context, target);
  if (result.ok) throw new Error("expected a publish error");
  return result.error;
};

describe("resolution order (§10.2)", () => {
  it("1. a local published item wins, fragment or thread", () => {
    const store = storeOf(item(A, { origin: DRAFT_ORIGIN, version: 4 }), item(id(2), { origin: DRAFT_ORIGIN, kind: "thread" }));
    expect(resolve(store, ctx, A)).toMatchObject({ ok: true, target: { id: A, version: 4, local: true, kind: "fragment" } });
    expect(resolve(store, ctx, id(2))).toMatchObject({ ok: true, target: { kind: "thread", local: true } });
  });

  it("2. otherwise an imported blyg item, with its identity origin", () => {
    const store = storeOf(item(A, { origin: REMOTE, version: 3, page: "p/a/" }));
    expect(resolve(store, ctx, A)).toMatchObject({
      ok: true,
      target: { origin: REMOTE, version: 3, local: false, retained: false, page: "p/a/" },
    });
  });

  it("3. otherwise a publish error: unknown", () => {
    expect(failure(storeOf(), A).code).toBe("unknown");
  });

  it("an imported thread resolves like a fragment", () => {
    const store = storeOf(item(A, { kind: "thread" }));
    expect(resolve(store, ctx, A)).toMatchObject({ ok: true, target: { kind: "thread" } });
  });
});

describe("local ids (decision #76)", () => {
  it("the draft's own id is not a target", () => {
    expect(failure(storeOf(), ctx.draftId).code).toBe("self");
  });

  it("another local draft is a publish error, and never falls through to an imported item", () => {
    const store = storeOf(item(A, { origin: REMOTE }));
    const withDraft = { ...ctx, otherDraftIds: new Set([A]) };
    expect(failure(store, A, withDraft).code).toBe("ambiguous");
    expect(failure(storeOf(), A, withDraft).code).toBe("draft");
  });

  it("a local published id that an imported document shares is ambiguous, not resolved", () => {
    const store = storeOf(item(A, { origin: DRAFT_ORIGIN }), item(A, { origin: REMOTE }));
    expect(failure(store, A).code).toBe("ambiguous");
  });

  it("a withdrawn local item is an error", () => {
    expect(failure(storeOf(item(A, { origin: DRAFT_ORIGIN, kind: "withdrawn", version: 2 })), A).code).toBe("withdrawn");
  });

  it("a thread may not quote a local thread whose closure contains it", () => {
    const quotesDraft = item(id(2), { origin: DRAFT_ORIGIN, kind: "thread", transclusions: [{ id: ctx.draftId, version: 1 }] });
    const viaMiddle = item(id(3), { origin: DRAFT_ORIGIN, kind: "thread", transclusions: [{ id: id(2), version: 1 }] });
    const store = storeOf(quotesDraft, viaMiddle);
    expect(failure(store, id(2)).code).toBe("cycle");
    expect(failure(store, id(3)).code).toBe("cycle");
  });

  it("remote closures are not walked", () => {
    const thread = item(id(2), { origin: DRAFT_ORIGIN, kind: "thread", transclusions: [{ id: ctx.draftId, version: 1, origin: OTHER }] });
    expect(resolve(storeOf(thread), ctx, id(2)).ok).toBe(true);
  });
});

describe("imported items (§10.2 step 2)", () => {
  it("more than one imported match is a publish error, never a guess", () => {
    const store = storeOf(item(A, { origin: REMOTE }), item(A, { origin: OTHER }));
    const error = failure(store, A);
    expect(error.code).toBe("ambiguous");
    expect(error.message).toContain(REMOTE);
    expect(error.message).toContain(OTHER);
  });

  it("a match elsewhere that is withdrawn with nothing retained does not make a current one ambiguous", () => {
    const store = storeOf(item(A, { origin: REMOTE }), item(A, { origin: OTHER, kind: "withdrawn", version: 2 }));
    expect(resolve(store, ctx, A)).toMatchObject({ ok: true, target: { origin: REMOTE } });
  });

  it("a withdrawn item with nothing retained is an error", () => {
    expect(failure(storeOf(item(A, { kind: "withdrawn", version: 2 })), A).code).toBe("withdrawn");
  });

  it("a withdrawn item with a pin-retained snapshot is still quotable, at the pinned version", () => {
    const store = storeOf(item(A, { version: 1, md: "Pinned words." }), item(A, { kind: "withdrawn", version: 3 }));
    expect(store.retain(REMOTE, item(A, { version: 2, md: "Pinned words." }))).toEqual([]);
    expect(resolve(store, ctx, A)).toMatchObject({ ok: true, target: { version: 2, retained: true, html: "<p>Pinned words.</p>\n" } });
  });

  it("an L0 row is never a target", () => {
    const store = new Store();
    store.putL0("https://feed.test/rss", item(A, { origin: "https://feed.test/rss" }));
    expect(failure(store, A).code).toBe("l0");
  });

  it("an L0 row does not make a blyg item ambiguous", () => {
    const store = storeOf(item(A, { origin: REMOTE }));
    store.putL0("https://feed.test/rss", item(A, { origin: "https://feed.test/rss" }));
    expect(resolve(store, ctx, A)).toMatchObject({ ok: true, target: { origin: REMOTE } });
  });
});
