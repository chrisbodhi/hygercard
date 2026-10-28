import { memo, useMemo } from "react";
import type { StoredItem } from "../../core/store";
import { textContent } from "../../core/textContent";
import { sanitize } from "../../harness/sanitize";
import type { DragPayload } from "./gestures";
import { excerpt } from "./pure";
import type { PointerEvent } from "react";

interface CardProps {
  row: StoredItem;
  onHandleDown: (event: PointerEvent, payload: DragPayload) => void;
}

/**
 * One item as a card: its sanitized content_html and a small meta line. Items
 * are titleless (§5.3), so there is no heading. A plain RSS (L0) entry is marked
 * and has no handle: it can never be a quotation target (§10.2).
 */
export const Card = memo(function Card({ row, onHandleDown }: CardProps) {
  const { doc } = row;
  const html = useMemo(() => sanitize(doc.content_html), [doc.content_html]);
  return (
    <article className={`cb-card${row.l0 ? " l0" : ""}`} data-card data-origin={row.origin} data-id={row.id}>
      <header className="cb-card-head">
        {!row.l0 && (
          <button
            className="cb-handle"
            title="drag to quote this whole item"
            aria-label="drag to quote this whole item"
            onPointerDown={(event) =>
              onHandleDown(event, { kind: "whole", item: { origin: row.origin, id: row.id }, label: excerpt(textContent(doc.content_html)) })
            }
          >
            ⠿
          </button>
        )}
        <span className="meta">
          {row.l0 ? "plain RSS (L0)" : `${doc.kind} · v${doc.version}`} · updated {doc.updated.slice(0, 10)}
        </span>
        {row.l0 && <span className="cb-badge" title="a legacy RSS entry has no id, no versions and no state plane">not quotable</span>}
      </header>
      <div className="cb-card-body" data-body dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
});
