import { motion } from "motion/react";
import { Fragment, useMemo, type PointerEvent, type ReactNode } from "react";
import type { BandState } from "../../core/anchors";
import type { BakeResult } from "../../core/bake";
import { proseText } from "../../core/draft";
import { sanitize } from "../../harness/sanitize";
import type { DragPayload } from "./gestures";
import { excerpt } from "./pure";

interface DraftProps {
  result: BakeResult;
  /** Parallel to the blocks: the state of the quote each one holds, if it holds one. */
  states: ReadonlyArray<BandState | null>;
  editing: number | null;
  /** The boundary a drag would drop on, if one is in progress. */
  over: number | null;
  onEdit: (index: number | null) => void;
  onCommitProse: (index: number, text: string) => void;
  onRemove: (index: number) => void;
  onAddProse: (boundary: number) => void;
  onHandleDown: (event: PointerEvent, payload: DragPayload) => void;
  weight: number;
  header: ReactNode;
  footer: ReactNode;
}

/** Keys that follow a block when it moves: its text, and which occurrence of that text it is. */
function keysOf(raws: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return raws.map((raw) => {
    const n = (seen.get(raw) ?? 0) + 1;
    seen.set(raw, n);
    return `${raw}#${n}`;
  });
}

/**
 * The draft, as the bake preview: each block as it will be published. Drops land
 * on the zones between blocks and nowhere else; an error sits on the block that
 * caused it.
 */
export function Draft({ result, states, editing, over, onEdit, onCommitProse, onRemove, onAddProse, onHandleDown, weight, header, footer }: DraftProps) {
  const { blocks, baked } = result;
  const keys = useMemo(() => keysOf(blocks.map((block) => block.raw)), [blocks]);

  const zone = (boundary: number) => (
    <div className="cb-zone" data-zone={boundary}>
      {over === boundary && <motion.div layoutId="drop-line" className="line" transition={{ duration: 0.12 }} />}
      <button className="add" onClick={() => onAddProse(boundary)} aria-label="add a paragraph here">
        + text
      </button>
    </div>
  );

  return (
    <section className="cb-col" data-side="center" style={{ flex: `${weight} 1 0` }}>
      <div className="cb-draft-head">{header}</div>
      <div className="cb-scroll" data-scroller data-draft>
        {zone(0)}
        {blocks.length === 0 && <p className="cb-empty">An empty draft. Drag a quote here, or add text.</p>}
        {blocks.map((block, index) => {
          const out = baked[index]!;
          const state = states[index];
          return (
            <Fragment key={keys[index]}>
              <motion.div
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className={`cb-block ${block.kind === "prose" ? "prose" : "quote"}`}
                data-block={index}
                data-kind={block.kind}
              >
                <div className="tools">
                  <button
                    className="cb-handle"
                    title="drag to move this block"
                    aria-label="drag to move this block"
                    onPointerDown={(event) => onHandleDown(event, { kind: "move", from: index, label: excerpt(block.raw, 60) })}
                  >
                    ⠿
                  </button>
                  <button onClick={() => onRemove(index)} aria-label="remove this block" title="remove this block">
                    ×
                  </button>
                </div>

                {out.errors.map((error, n) => (
                  <div key={n} className="cb-error" role="alert">
                    ⚠ <code>{error.code}</code> {error.message}
                  </div>
                ))}

                {block.kind === "prose" ? (
                  editing === index ? (
                    <textarea
                      autoFocus
                      defaultValue={proseText(block.raw)}
                      aria-label="paragraph text (markdown)"
                      onBlur={(event) => onCommitProse(index, event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Escape") onEdit(null); }}
                    />
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onEdit(index)}
                      onKeyDown={(event) => { if (event.key === "Enter") onEdit(index); }}
                      dangerouslySetInnerHTML={{ __html: out.html ? sanitize(out.html) : `<code>${proseText(block.raw).slice(0, 120)}</code>` }}
                    />
                  )
                ) : out.html ? (
                  <div dangerouslySetInnerHTML={{ __html: sanitize(out.html) }} />
                ) : (
                  <code>{block.raw.trim()}</code>
                )}
                {block.kind !== "prose" && state && state !== "current" && <span className="state">source {state}</span>}
              </motion.div>
              {zone(index + 1)}
            </Fragment>
          );
        })}
      </div>
      {footer}
    </section>
  );
}
