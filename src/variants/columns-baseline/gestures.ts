// The two gestures, on pointer events throughout: dragging a handle to a block
// boundary in the draft, and selecting text within one item to make it a quote.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Store } from "../../core/store";
import { textContent } from "../../core/textContent";
import type { HarnessEvent, ItemRef } from "../../harness/events";
import { domText, readSelection, selectionOffsets } from "../../harness/domText";
import { nearestBoundary, excerpt } from "./pure";

// --- Dragging to a boundary ---------------------------------------------------

export type DragPayload =
  | { kind: "whole"; item: ItemRef; label: string }
  | { kind: "partial"; item: ItemRef; exact: string; start: number; end: number }
  | { kind: "move"; from: number; label: string };

export interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
  /** The boundary zone a drop here would land on; null outside the draft. */
  over: number | null;
}

const EDGE = 40;
const SCROLL_STEP = 14;

interface DragOptions {
  /** The draft's scroll container; its `[data-zone]` children are the drop zones. */
  draft: () => HTMLElement | null;
  threshold: () => number;
  emit: (event: HarnessEvent) => void;
  onDrop: (payload: DragPayload, boundary: number) => void;
}

const describe = (p: DragPayload): Pick<Extract<HarnessEvent, { type: "drag.start" }>, "kind" | "item" | "from" | "start" | "end"> =>
  p.kind === "whole" ? { kind: "whole", item: p.item }
  : p.kind === "partial" ? { kind: "partial", item: p.item, start: p.start, end: p.end }
  : { kind: "move", from: p.from };

export function useDrag(options: DragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const begin = useCallback((event: ReactPointerEvent, payload: DragPayload) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Keep the text selection: a partial quote's handle is pressed while the passage is selected.
    event.preventDefault();
    stop.current?.();

    const origin = { x: event.clientX, y: event.clientY };
    let active = false;
    let over: number | null = null;

    const zoneAt = (x: number, y: number): number | null => {
      const draft = latest.current.draft();
      if (!draft) return null;
      const box = draft.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
      // Scroll the draft when the pointer lingers at its edge.
      if (y < box.top + EDGE) draft.scrollTop -= SCROLL_STEP;
      else if (y > box.bottom - EDGE) draft.scrollTop += SCROLL_STEP;
      const centres = [...draft.querySelectorAll<HTMLElement>("[data-zone]")].map((zone) => {
        const r = zone.getBoundingClientRect();
        return (r.top + r.bottom) / 2;
      });
      return centres.length ? nearestBoundary(centres, y) : null;
    };

    const move = (e: PointerEvent) => {
      if (!active) {
        if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < latest.current.threshold()) return;
        active = true;
        latest.current.emit({ type: "drag.start", ...describe(payload) });
      }
      over = zoneAt(e.clientX, e.clientY);
      setDrag({ payload, x: e.clientX, y: e.clientY, over });
    };

    const finish = (cancelled?: string) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
      removeEventListener("keydown", key);
      stop.current = null;
      setDrag(null);
      if (!active) return; // never left the threshold: a click, and nothing happened
      const reason = cancelled ?? (over === null ? "released outside the draft" : undefined);
      if (reason !== undefined || over === null) latest.current.emit({ type: "drag.cancel", kind: payload.kind, reason: reason ?? "released outside the draft" });
      else latest.current.onDrop(payload, over);
    };
    const up = () => finish();
    const cancel = () => finish("pointer cancelled");
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") finish("escape"); };

    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", cancel);
    addEventListener("keydown", key);
    stop.current = () => finish("interrupted");
  }, []);

  return { drag, begin };
}

// --- Selecting a passage in one item -------------------------------------------

export interface ActiveSelection {
  item: ItemRef;
  exact: string;
  start: number;
  end: number;
  /** A copy of the selection's range, which the overlay tracks to place the handle. */
  range: Range;
  /** The scroll container the item is in. */
  scroller: HTMLElement | null;
}

export interface SelectionReading {
  active: ActiveSelection | null;
  /** Why the current selection cannot be quoted; shown, never silent. */
  rejected: string | null;
}

const DEBOUNCE_MS = 120;

/**
 * Watch the document selection. A selection inside one source item that is a
 * substring of its §10.2 text content is a candidate quote; one spanning
 * several items, or inside a plain RSS item, is rejected with the reason.
 */
export function useSelectionWatch(root: HTMLElement | null, store: Store, emit: (event: HarnessEvent) => void): SelectionReading {
  const [reading, setReading] = useState<SelectionReading>({ active: null, rejected: null });
  const lastKey = useRef("");

  useEffect(() => {
    if (!root) return;
    let timer: ReturnType<typeof setTimeout>;

    const evaluate = () => {
      const selection = getSelection();
      const range = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
      /** Log an event unless it repeats the last one. Says whether it did. */
      const log = (event: HarnessEvent, key: string): boolean => {
        if (key === lastKey.current) return false;
        lastKey.current = key;
        emit(event);
        return true;
      };
      if (!range) {
        lastKey.current = "";
        return setReading({ active: null, rejected: null });
      }

      // Items the selection actually covers text of (merely touching an item's edge does not count).
      const cards = [...root.querySelectorAll<HTMLElement>("[data-card]")].filter((card) => range.intersectsNode(card));
      const covered = cards
        .map((card) => ({ card, body: card.querySelector<HTMLElement>("[data-body]")! }))
        .map((entry) => ({ ...entry, dt: domText(entry.body) }))
        .filter((entry) => selectionOffsets(entry.dt, range) !== null);

      if (covered.length === 0) return setReading({ active: null, rejected: null }); // not in a source column
      if (covered.length > 1) {
        const reason = `the selection spans ${covered.length} items: select within one item`;
        log({ type: "selection.changed", valid: false, reason }, `spans:${covered.length}`);
        return setReading({ active: null, rejected: reason });
      }

      const { card, body, dt } = covered[0]!;
      const item: ItemRef = { origin: card.dataset.origin!, id: card.dataset.id! };
      const row = store.get(item.origin, item.id);
      if (!row || row.l0) {
        const reason = "a plain RSS (L0) entry can never be quoted: it is not a blyg item";
        log({ type: "selection.changed", item, valid: false, reason }, `l0:${item.id}`);
        return setReading({ active: null, rejected: reason });
      }

      const read = readSelection(dt, range, textContent(row.doc.content_html));
      if (!read.valid) {
        log({ type: "selection.changed", item, valid: false, reason: read.reason, ...(read.exact ? { text: excerpt(read.exact, 120) } : {}) }, `bad:${item.id}:${read.reason}`);
        return setReading({ active: null, rejected: read.reason });
      }

      const key = `ok:${item.origin}:${item.id}:${read.start}:${read.end}`;
      const fresh = log({ type: "selection.changed", item, start: read.start, end: read.end, text: excerpt(read.exact, 120), valid: true }, key);

      // Allowed, since it is still a substring of the outer item's text content, but noted: a design question for later.
      const common = range.commonAncestorContainer;
      const nested = (common instanceof Element ? common : common.parentElement)?.closest<HTMLElement>("blockquote.blyg-transclusion");
      if (fresh && nested && body.contains(nested)) {
        let depth = 0;
        for (let el: Element | null = nested; el && body.contains(el); el = el.parentElement?.closest("blockquote.blyg-transclusion") ?? null) depth++;
        emit({ type: "selection.nested-quote", item, quotedId: nested.dataset.blygId ?? "", depth });
      }

      setReading({
        active: { item, exact: read.exact, start: read.start, end: read.end, range: range.cloneRange(), scroller: card.closest<HTMLElement>("[data-scroller]") },
        rejected: null,
      });
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(evaluate, DEBOUNCE_MS);
    };
    document.addEventListener("selectionchange", schedule);
    return () => {
      document.removeEventListener("selectionchange", schedule);
      clearTimeout(timer);
    };
  }, [root, store, emit]);

  return reading;
}
