// The shell every variant runs in: a URL-addressable variant switcher, persisted
// knobs, the fixtures/live data toggle, the interaction event log and the keymap.
// Plain on purpose: this is scaffolding for interaction prototypes, not a design.

import { Leva, useControls } from "leva";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Store } from "../core/store";
import { loadFixtures } from "../feeds/fixtures";
import { proxyFetcher } from "../feeds/http";
import { loadLive } from "../feeds/live";
import { copyEventsAsJson, emit, eventLog, useEvents } from "./events";
import { readFixture } from "./fixtureReader";
import { Keymap } from "./keymap";
import { readJson, writeJson } from "./persist";
import { variantById, variants, type KnobSchema, type KnobValues, type Variant } from "./registry";

const store = new Store();
const keymap = new Keymap();

type Mode = "fixtures" | "live";

// --- Routing: ?variant=<id> --------------------------------------------------

function currentVariantId(): string | null {
  return new URLSearchParams(location.search).get("variant");
}

function useVariant(): [Variant | undefined, (id: string) => void] {
  const [id, setId] = useState(currentVariantId);
  useEffect(() => {
    const onPop = () => setId(currentVariantId());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const select = (next: string) => {
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.pushState(null, "", url);
    setId(next);
  };
  return [variantById(id) ?? variants[0], select];
}

// --- Knobs, persisted ----------------------------------------------------------

const knobKey = (variantId: string) => `hygercard:knobs:${variantId}`;

function useKnobs<S extends KnobSchema>(variant: Variant<S>): KnobValues<S> {
  const schema = useMemo(() => {
    const saved = readJson<Record<string, unknown>>(knobKey(variant.id), {});
    return Object.fromEntries(
      Object.entries(variant.knobs).map(([name, spec]) => {
        const value = saved[name];
        // A saved value of the wrong type (a knob that changed shape since) is ignored.
        return [name, typeof value === typeof spec.value ? { ...spec, value } : spec];
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant.id]);
  const values = useControls(variant.name, schema as never, [variant.id]) as unknown as KnobValues<S>;
  const serialized = JSON.stringify(values);
  useEffect(() => writeJson(knobKey(variant.id), JSON.parse(serialized)), [variant.id, serialized]);
  return values;
}

// --- Data: fixtures or live ------------------------------------------------------

function useData(mode: Mode): string {
  const [message, setMessage] = useState("loading fixtures…");
  useEffect(() => {
    let current = true;
    store.clear();
    if (mode === "live") {
      setMessage("live: add a source by URL below");
      return;
    }
    setMessage("loading fixtures…");
    loadFixtures(store, readFixture).then(
      ({ index, issues }) => current && setMessage(`${index.sources.length} sources from fixtures (captured ${index.capturedAt}); ${issues.length} issue(s) recorded on import`),
      (error: unknown) => current && setMessage(`could not load fixtures: ${error instanceof Error ? error.message : String(error)}. Run \`bun run snapshot\`.`),
    );
    return () => {
      current = false;
    };
  }, [mode]);
  return message;
}

function LiveBar({ onStatus }: { onStatus: (message: string) => void }) {
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const suggestions = useMemo(() => {
    const index = readJson<string[]>("hygercard:live-urls", []);
    return index;
  }, []);
  const load = async () => {
    if (!url.trim()) return;
    setBusy(true);
    onStatus(`loading ${url}…`);
    const result = await loadLive(store, url.trim(), proxyFetcher(), limit);
    onStatus(result.message);
    writeJson("hygercard:live-urls", [...new Set([url.trim(), ...suggestions])].slice(0, 20));
    setBusy(false);
  };
  return (
    <form className="live" onSubmit={(e) => { e.preventDefault(); void load(); }}>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/blyg/  (a blyg, a feed, or a page; resolved by §12)" list="live-urls" size={60} />
      <datalist id="live-urls">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      <label>items <input type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: "4em" }} /></label>
      <button disabled={busy}>load</button>
    </form>
  );
}

// --- Panels ----------------------------------------------------------------------

function EventLog() {
  const events = useEvents();
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <section className="panel log">
      <div className="panel-bar">
        <strong>events ({events.length})</strong>
        <button onClick={async () => setCopied(await copyEventsAsJson(events))}>copy as JSON</button>
        <button onClick={eventLog.clear}>clear</button>
        {copied !== null && <span>{copied ? "copied" : "copy failed: select the text below"}</span>}
      </div>
      <ol reversed>
        {[...events].reverse().slice(0, 60).map(({ seq, at, event }) => (
          <li key={seq}>
            <span className="time">{at.slice(11, 23)}</span> <b>{event.type}</b> <code>{JSON.stringify({ ...event, type: undefined })}</code>
          </li>
        ))}
      </ol>
    </section>
  );
}

function KeyHelp() {
  useSyncExternalStore(
    (notify) => { const t = setInterval(notify, 1000); return () => clearInterval(t); },
    () => keymap.list().map((b) => b.sequence).join("|"),
  );
  return (
    <section className="panel keys">
      <strong>keys</strong>
      <dl>
        {keymap.list().map((binding) => (
          <div key={binding.sequence}>
            <dt><kbd>{binding.sequence}</kbd></dt>
            <dd>{binding.description}</dd>
          </div>
        ))}
        {keymap.list().length === 0 && <dd>no bindings registered</dd>}
      </dl>
    </section>
  );
}

// --- The shell ---------------------------------------------------------------------

export function Harness() {
  const [variant, select] = useVariant();
  const [mode, setMode] = useState<Mode>(() => readJson<Mode>("hygercard:mode", "fixtures"));
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const dataMessage = useData(mode);
  const [showLog, setShowLog] = useState(() => readJson("hygercard:log", true));
  const [showKeys, setShowKeys] = useState(false);
  const events = useEvents();

  useEffect(() => keymap.attach(document), []);
  useEffect(() => writeJson("hygercard:mode", mode), [mode]);
  useEffect(() => writeJson("hygercard:log", showLog), [showLog]);

  if (!variant) return <p className="empty">No variants found under src/variants/.</p>;

  return (
    <div className="harness">
      <header className="bar">
        <strong>hygercard</strong>
        <select value={variant.id} onChange={(e) => select(e.target.value)} aria-label="variant">
          {variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <span className="desc">{variant.description}</span>
        <span className="spacer" />
        <label>
          data{" "}
          <select value={mode} onChange={(e) => { setLiveMessage(null); setMode(e.target.value as Mode); }} aria-label="data source">
            <option value="fixtures">fixtures</option>
            <option value="live">live (via dev proxy)</option>
          </select>
        </label>
        <button onClick={() => setShowKeys(!showKeys)} aria-pressed={showKeys}>keys</button>
        <button onClick={() => setShowLog(!showLog)} aria-pressed={showLog}>log {events.length}</button>
      </header>
      {mode === "live" && <LiveBar onStatus={setLiveMessage} />}
      <div className="status">{liveMessage ?? dataMessage}</div>
      <main className="stage">
        <VariantHost key={variant.id} variant={variant} live={mode === "live"} />
      </main>
      {showLog && <EventLog />}
      {showKeys && <KeyHelp />}
      <Leva collapsed titleBar={{ title: "knobs", position: { x: 0, y: 96 } }} />
    </div>
  );
}

function VariantHost({ variant, live }: { variant: Variant; live: boolean }) {
  const knobs = useKnobs(variant);
  const { Component } = variant;
  return <Component knobs={knobs} store={store} keymap={keymap} emit={emit} live={live} />;
}
