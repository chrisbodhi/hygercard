// columns-baseline: the reference variant, deliberately plain.
//
//   left, right   two imported blygs, each chosen by a picker, as cards
//   center        the draft, rendered as the bake preview, with a raw content_md pane
//   gestures      drag a card's handle: a whole quote. Select text within one card,
//                 then drag the selection handle: a partial quote
//   bands         ribbons from each quote's source to its block, coloured by state

import { motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { bandState, type Anchor, type BandReading, type BandState } from "../../core/anchors";
import { bake } from "../../core/bake";
import { commit, editProse, insertPartialQuote, insertProse, insertWholeQuote, moveBlock, redo, removeBlock, startHistory, undo, type History } from "../../core/draft";
import { exportDocument, newDraftMeta, type DraftMeta } from "../../core/export";
import { textContent } from "../../core/textContent";
import { domText, rangeFromOffsets } from "../../harness/domText";
import { Bands, useTracker, type BandSpec, type EndpointSpec, type Readings } from "../../harness/overlay";
import { readJson, writeJson } from "../../harness/persist";
import type { VariantProps } from "../../harness/variant";
import { Draft } from "./Draft";
import { useDrag, useSelectionWatch, type DragPayload } from "./gestures";
import { changedLines, excerpt } from "./pure";
import { SourceColumn } from "./SourceColumn";
import type { schema } from "./index";
import "./styles.css";

const KEY = { draft: "hygercard:cb:draft", meta: "hygercard:cb:meta", seen: "hygercard:cb:seen", left: "hygercard:cb:left", right: "hygercard:cb:right", raw: "hygercard:cb:raw" };
const INITIAL = "Drag a quote from either stream into this draft, or write here.\n";
const PREFERRED = { left: "https://blyg.protocol-institute.org/", right: "https://venkateshrao.com/blyg/" };
const NO_READINGS: Readings = new Map();

type LocalBand = BandSpec & { cardKey: string };

/** The version of a quoted item the author last saw. A draft re-bakes against the store, so this is what staleness is measured from. */
interface Seen {
  origin: string;
  version: number;
}

function loadMeta(): DraftMeta {
  const saved = readJson<DraftMeta | null>(KEY.meta, null);
  if (saved) return saved;
  const made = newDraftMeta();
  writeJson(KEY.meta, made);
  return made;
}

function findCard(root: HTMLElement, origin: string, id: string): HTMLElement | null {
  for (const card of root.querySelectorAll<HTMLElement>("[data-card]")) {
    if (card.dataset.origin === origin && card.dataset.id === id) return card;
  }
  return null;
}

/** The DOM range of the passage a partial quote came from, if the rendered text is the stored text. */
function passageRange(card: HTMLElement, anchor: Anchor, storedText: string): Range | null {
  if (anchor.kind === "orphaned") return null;
  const body = card.querySelector<HTMLElement>("[data-body]");
  if (!body) return null;
  const dt = domText(body);
  return dt.layout.text === storedText ? rangeFromOffsets(dt, anchor.start, anchor.end) : null;
}

export function ColumnsBaseline({ knobs, store, keymap, emit }: VariantProps<typeof schema>) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const tracker = useTracker(root);
  const revision = useSyncExternalStore(store.subscribe, () => store.revision);
  const readings = useSyncExternalStore(tracker?.subscribe ?? (() => () => {}), () => tracker?.snapshot() ?? NO_READINGS);

  // --- The two source columns ---
  // Only what the person picks is remembered; the defaults are derived, so they settle as sources arrive.
  const [pickedLeft, setLeft] = useState<string | null>(() => readJson(KEY.left, null));
  const [pickedRight, setRight] = useState<string | null>(() => readJson(KEY.right, null));
  const origins = useMemo(() => store.sources().map((source) => source.origin), [revision, store]);
  const left = pickedLeft !== null && origins.includes(pickedLeft) ? pickedLeft : origins.includes(PREFERRED.left) ? PREFERRED.left : (origins[0] ?? null);
  const right =
    pickedRight !== null && origins.includes(pickedRight) ? pickedRight
    : origins.includes(PREFERRED.right) && PREFERRED.right !== left ? PREFERRED.right
    : (origins.find((origin) => origin !== left) ?? null);
  const pickLeft = (origin: string) => { setLeft(origin); writeJson(KEY.left, origin); };
  const pickRight = (origin: string) => { setRight(origin); writeJson(KEY.right, origin); };

  // --- The draft: content_md is the whole of it, with undo and redo ---
  const [meta, setMeta] = useState(loadMeta);
  const [history, setHistory] = useState<History>(() => startHistory(readJson(KEY.draft, INITIAL)));
  const [flash, setFlash] = useState<{ from: string; to: string } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(() => readJson(KEY.raw, true));
  const md = history.present;
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => writeJson(KEY.draft, md), [md]);
  useEffect(() => writeJson(KEY.raw, showRaw), [showRaw]);

  const change = useCallback((next: History) => {
    setFlash({ from: historyRef.current.present, to: next.present });
    setHistory(next);
  }, []);
  const apply = useCallback((md: string) => change(commit(historyRef.current, md)), [change]);
  const doUndo = useCallback(() => change(undo(historyRef.current)), [change]);
  const doRedo = useCallback(() => change(redo(historyRef.current)), [change]);
  useEffect(() => {
    const unbind = [
      keymap.bind("C-/", "undo the last change to the draft", doUndo),
      keymap.bind("C-?", "redo", doRedo),
    ];
    return () => unbind.forEach((off) => off());
  }, [keymap, doUndo, doRedo]);

  // --- The bake preview, and what it says ---
  const result = useMemo(() => bake(md, store, { origin: meta.origin, draftId: meta.id }), [md, revision, meta, store]);
  const lastBake = useRef("");
  useEffect(() => {
    const signature = JSON.stringify([result.blocks.length, result.transclusions.length, result.errors.map((e) => [e.block, e.code, e.message])]);
    if (signature === lastBake.current) return;
    lastBake.current = signature;
    emit({ type: "bake.result", blocks: result.blocks.length, transclusions: result.transclusions.length, errors: result.errors.map(({ block, code, message }) => ({ block, code, message })) });
  }, [result, emit]);

  // What the author last saw of each quoted item. A draft re-bakes against the store at every change, so
  // the baked reference is always current; staleness is the store moving past what was seen. Refreshing
  // is the author accepting the newer version, as republishing re-resolves every directive (§10.2).
  const [seen, setSeen] = useState<Record<string, Seen>>(() => readJson(KEY.seen, {}));
  useEffect(() => writeJson(KEY.seen, seen), [seen]);
  useEffect(() => {
    const first: Record<string, Seen> = {};
    for (const baked of result.baked) {
      const entry = baked.transclusion;
      if (entry && !seen[entry.id]) first[entry.id] = { origin: entry.origin ?? meta.origin, version: entry.version };
    }
    if (Object.keys(first).length > 0) setSeen((current) => ({ ...first, ...current }));
  }, [result, seen, meta]);

  /** Each quote's state, from its seen reference and the store. A quote that failed to bake still has one. */
  const states = useMemo<Array<BandReading | null>>(
    () =>
      result.blocks.map((block, index) => {
        if (block.kind !== "directive" && block.kind !== "partial") return null;
        const baked = result.baked[index]?.transclusion;
        const note = seen[block.id] ?? (baked ? { origin: baked.origin ?? meta.origin, version: baked.version } : undefined);
        if (!note) return null;
        const selector = block.kind === "partial" ? (baked?.selector ?? { exact: block.selection }) : undefined;
        return bandState({ id: block.id, version: note.version, origin: note.origin, ...(selector ? { selector } : {}) }, store, meta.origin);
      }),
    [result, seen, revision, store, meta],
  );
  const stale = states.some((reading) => reading?.state === "stale");
  const refresh = () =>
    setSeen((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, note]) => {
          const row = store.get(note.origin, id);
          return [id, row && row.state === "current" ? { ...note, version: row.doc.version } : note];
        }),
      ),
    );

  const previousStates = useRef(new Map<string, BandState>());
  useEffect(() => {
    const next = new Map<string, BandState>();
    states.forEach((reading, index) => {
      const block = result.blocks[index];
      if (!reading || !block || (block.kind !== "directive" && block.kind !== "partial")) return;
      const band = `block ${index} -> ${block.id.slice(0, 8)}`;
      next.set(band, reading.state);
      const previous = previousStates.current.get(band);
      if (previous !== reading.state) {
        emit({ type: "band.state", band, state: reading.state, ...(previous ? { previous } : {}), ...(reading.anchor ? { anchor: reading.anchor.kind } : {}) });
      }
    });
    previousStates.current = next;
  }, [states, result, emit]);

  // --- Gestures ---
  const dragThreshold = useRef(knobs.dragThreshold);
  dragThreshold.current = knobs.dragThreshold;
  const selection = useSelectionWatch(root, store, emit);

  const onDrop = useCallback(
    (payload: DragPayload, boundary: number) => {
      const current = historyRef.current.present;
      try {
        if (payload.kind === "whole") {
          apply(insertWholeQuote(current, boundary, payload.item.id));
          emit({ type: "drop.commit", directive: "whole", boundary, item: payload.item });
        } else if (payload.kind === "partial") {
          apply(insertPartialQuote(current, boundary, payload.item.id, payload.exact));
          emit({ type: "drop.commit", directive: "partial", boundary, item: payload.item, selection: payload.exact });
          getSelection()?.removeAllRanges();
        } else {
          const moved = moveBlock(current, payload.from, boundary);
          if (moved === current) return emit({ type: "drag.cancel", kind: "move", reason: "dropped where it already was" });
          apply(moved);
          emit({ type: "drop.commit", directive: "move", boundary, from: payload.from });
        }
        setNotice(null);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setNotice(`could not write that: ${reason}`);
        emit({ type: "drag.cancel", kind: payload.kind, reason });
      }
    },
    [apply, emit],
  );
  const { drag, begin } = useDrag({
    draft: () => root?.querySelector<HTMLElement>("[data-draft]") ?? null,
    threshold: () => dragThreshold.current,
    emit,
    onDrop,
  });

  // --- Bands: built after the DOM they point into exists ---
  const [bands, setBands] = useState<LocalBand[]>([]);
  useLayoutEffect(() => {
    if (!root) return;
    const built: LocalBand[] = [];
    result.blocks.forEach((block, index) => {
      const reading = states[index];
      if (!reading || (block.kind !== "directive" && block.kind !== "partial")) return;
      const origin = seen[block.id]?.origin ?? result.baked[index]?.transclusion?.origin ?? meta.origin;
      const card = findCard(root, origin, block.id);
      if (!card) return; // the source is not in either column: nothing to attach to
      const side = card.closest<HTMLElement>("[data-side]")?.dataset.side === "right" ? "right" : "left";
      const storedText = reading.item ? textContent(reading.item.doc.content_html) : "";
      let range: Range | null | undefined;
      built.push({
        id: `block-${index}`,
        state: reading.state,
        cardKey: `${origin}|${block.id}`,
        source: {
          id: `source-${index}`,
          side: side === "left" ? "right" : "left",
          scroller: () => card.closest<HTMLElement>("[data-scroller]"),
          target: () => {
            if (!card.isConnected) return null;
            if (reading.anchor) {
              if (range === undefined || range?.collapsed) range = passageRange(card, reading.anchor, storedText);
              if (range) return range;
            }
            return card;
          },
        },
        center: {
          id: `center-${index}`,
          side,
          scroller: () => root.querySelector<HTMLElement>("[data-draft]"),
          target: () => root.querySelector<HTMLElement>(`[data-block="${index}"]`),
        },
      });
    });
    setBands(built);
  }, [root, result, states, seen, left, right, meta, revision]);
  // Layout animations move blocks without any event the tracker listens for.
  useEffect(() => tracker?.pulse(600), [tracker, md, left, right]);

  const [hover, setHover] = useState<string | null>(null);
  const hovered = useMemo(
    () => new Set(bands.filter((band) => hover === `block:${band.id.slice(6)}` || hover === `card:${band.cardKey}`).map((band) => band.id)),
    [bands, hover],
  );

  // The selection handle follows the selection through the same tracker.
  const handleSpec = useMemo<EndpointSpec[]>(
    () => (selection.active ? [{ id: "handle", side: "right", target: () => selection.active!.range, scroller: () => selection.active!.scroller }] : []),
    [selection.active],
  );
  const handleAt = selection.active ? readings.get("handle") : null;

  // --- Export ---
  const doExport = () => {
    const out = exportDocument(md, meta, store);
    if (!out.ok) return setNotice(`cannot export: ${out.errors.length} publish error(s); they are marked on their blocks`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(out.doc, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${meta.id}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setNotice(`exported ${meta.id}.json: version 1, ${out.doc.transclusions?.length ?? 0} transclusion(s)`);
  };

  const changed = flash ? changedLines(flash.from, flash.to) : null;
  const rawLines = md.split("\n");

  const header = (
    <>
      <button onClick={doUndo} disabled={history.past.length === 0} title="C-/">undo</button>
      <button onClick={doRedo} disabled={history.future.length === 0} title="C-?">redo</button>
      <button onClick={() => apply("")} disabled={md === ""}>clear</button>
      <button onClick={refresh} disabled={!stale} title="accept the newer version of every quoted item, as republishing re-resolves each directive">refresh quotes</button>
      <span className="grow" title={`${meta.origin} (placeholder origin)`}>draft {meta.id.slice(0, 8)}…</span>
      <button onClick={() => setShowRaw(!showRaw)} aria-pressed={showRaw}>content_md</button>
      <button onClick={doExport}>export item document</button>
    </>
  );
  const footer = showRaw && (
    <pre className="cb-raw" aria-label="content_md">
      {rawLines.map((line, index) => (
        <div key={index} className={changed && index >= changed.start && index < changed.end ? "changed" : undefined}>
          {line || " "}
        </div>
      ))}
    </pre>
  );

  const status = selection.rejected ? (
    <span className="rejected">selection rejected: {selection.rejected}</span>
  ) : selection.active ? (
    <span>
      {selection.active.exact.length} characters selected in {selection.active.item.id.slice(0, 8)}… at text-content offsets {selection.active.start}–{selection.active.end}: drag the handle into the draft
    </span>
  ) : (
    <span>{notice ?? "select text within one item, or drag a card's handle. C-/ undoes, C-? redoes."}</span>
  );

  return (
    <div
      className="cb-root"
      ref={setRoot}
      onPointerOver={(event) => {
        const target = event.target as Element;
        const block = target.closest<HTMLElement>("[data-block]");
        const card = target.closest<HTMLElement>("[data-card]");
        setHover(block ? `block:${block.dataset.block}` : card ? `card:${card.dataset.origin}|${card.dataset.id}` : null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="cb-status" role="status">{status}</div>
      <div className="cb-columns">
        <SourceColumn side="left" store={store} origin={left} onOrigin={pickLeft} onHandleDown={begin} weight={knobs.leftWidth} />
        <Draft
          result={result}
          states={states.map((reading) => reading?.state ?? null)}
          editing={editing}
          over={drag?.over ?? null}
          onEdit={setEditing}
          onCommitProse={(index, text) => { setEditing(null); apply(editProse(md, index, text)); }}
          onRemove={(index) => apply(removeBlock(md, index))}
          onAddProse={(boundary) => { apply(insertProse(md, boundary, "New paragraph.")); setEditing(boundary); }}
          onHandleDown={begin}
          weight={knobs.centerWidth}
          header={header}
          footer={footer}
        />
        <SourceColumn side="right" store={store} origin={right} onOrigin={pickRight} onHandleDown={begin} weight={knobs.rightWidth} />
      </div>

      <Bands tracker={tracker} bands={bands} curvature={knobs.bandCurvature} opacity={knobs.bandOpacity} visibility={knobs.bandVisibility} hovered={hovered} extra={handleSpec} />

      {selection.active && handleAt && handleAt.clamp === null && root && (
        <div className="cb-selection-handle" style={{ left: Math.min(handleAt.x + 6, root.clientWidth - 150), top: handleAt.bottom + 4 }}>
          <button
            className="cb-handle"
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => begin(event, { kind: "partial", item: selection.active!.item, exact: selection.active!.exact, start: selection.active!.start, end: selection.active!.end })}
          >
            ⠿ quote selection
          </button>
        </div>
      )}

      {drag && (
        <motion.div className="cb-ghost" initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ left: drag.x + 14, top: drag.y + 14 }}>
          {drag.payload.kind === "whole" && <><code>![[{drag.payload.item.id.slice(0, 8)}…]]</code>{drag.payload.label}</>}
          {drag.payload.kind === "partial" && <><code>![[{drag.payload.item.id.slice(0, 8)}…]] + selection</code>{excerpt(drag.payload.exact)}</>}
          {drag.payload.kind === "move" && <><code>move block {drag.payload.from}</code>{drag.payload.label}</>}
        </motion.div>
      )}
    </div>
  );
}
