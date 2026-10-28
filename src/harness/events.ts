// The interaction event log: what a gesture did, in the harness's own words, so
// that an interaction can be replayed from a paste ("Copy as JSON") and compared
// across variants.

import { useSyncExternalStore } from "react";
import type { Anchor, BandState } from "../core/anchors";

export interface ItemRef {
  origin: string;
  id: string;
}

export type HarnessEvent =
  /** A selection over rendered items. Offsets are into the item's §10.2 text content. */
  | { type: "selection.changed"; item?: ItemRef; start?: number; end?: number; text?: string; valid: boolean; reason?: string }
  /** A selection that lies inside a baked nested quote: allowed, and a design question for later. */
  | { type: "selection.nested-quote"; item: ItemRef; quotedId: string; depth: number }
  /** `move` reorders a block already in the draft; the others write a directive. */
  | { type: "drag.start"; kind: "whole" | "partial" | "move"; item?: ItemRef; from?: number; start?: number; end?: number }
  | { type: "drag.cancel"; kind: "whole" | "partial" | "move"; reason: string }
  /** The directive a drop wrote into content_md (or `move`, which writes none). */
  | { type: "drop.commit"; directive: "whole" | "partial" | "move"; boundary: number; item?: ItemRef; from?: number; selection?: string }
  | { type: "bake.result"; blocks: number; transclusions: number; errors: Array<{ block: number; code: string; message: string }> }
  | { type: "band.state"; band: string; state: BandState; previous?: BandState; anchor?: Anchor["kind"] };

export interface LoggedEvent {
  seq: number;
  at: string;
  event: HarnessEvent;
}

const LIMIT = 1000;

class EventLog {
  private events: readonly LoggedEvent[] = [];
  private listeners = new Set<() => void>();
  private seq = 0;

  emit = (event: HarnessEvent): void => {
    this.events = [...this.events, { seq: ++this.seq, at: new Date().toISOString(), event }].slice(-LIMIT);
    for (const listener of this.listeners) listener();
  };

  clear = (): void => {
    this.events = [];
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): readonly LoggedEvent[] => this.events;
}

export const eventLog = new EventLog();
export const emit = eventLog.emit;

export function useEvents(): readonly LoggedEvent[] {
  return useSyncExternalStore(eventLog.subscribe, eventLog.snapshot);
}

/**
 * Copy text to the clipboard. `navigator.clipboard` needs a secure context, and
 * the iPad reaches the dev server over plain http, so fall back to a selection
 * and execCommand. Returns whether anything was copied.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

export const copyEventsAsJson = (events: readonly LoggedEvent[]) => copyText(JSON.stringify(events, null, 2));
