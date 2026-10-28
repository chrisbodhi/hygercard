import { useSyncExternalStore, type PointerEvent } from "react";
import type { Store } from "../../core/store";
import { Card } from "./Card";
import type { DragPayload } from "./gestures";

interface SourceColumnProps {
  side: "left" | "right";
  store: Store;
  origin: string | null;
  onOrigin: (origin: string) => void;
  onHandleDown: (event: PointerEvent, payload: DragPayload) => void;
  weight: number;
}

/** A column showing one imported blyg, chosen by a picker. It scrolls on its own. */
export function SourceColumn({ side, store, origin, onOrigin, onHandleDown, weight }: SourceColumnProps) {
  useSyncExternalStore(store.subscribe, () => store.revision);
  const sources = store.sources().sort((a, b) => a.title.localeCompare(b.title));
  const rows = origin ? store.items(origin) : [];
  return (
    <section className="cb-col" data-side={side} style={{ flex: `${weight} 1 0` }}>
      <div className="cb-col-head">
        <select value={origin ?? ""} onChange={(event) => onOrigin(event.target.value)} aria-label={`${side} stream`}>
          {origin === null && <option value="">choose a blyg…</option>}
          {sources.map((source) => (
            <option key={source.origin} value={source.origin}>
              {source.title}
              {source.level === "l0" ? " (plain RSS)" : ""}
            </option>
          ))}
        </select>
        <span>{rows.length}</span>
      </div>
      <div className="cb-scroll" data-scroller>
        {rows.map((row) => (
          <Card key={`${row.origin} ${row.id}`} row={row} onHandleDown={onHandleDown} />
        ))}
        {origin && rows.length === 0 && <p className="cb-empty">nothing in the store for this source</p>}
      </div>
    </section>
  );
}
