// The smallest possible variant, and the template to copy: it declares one knob,
// reads the store, binds a key and logs an event. Delete it freely.

import { useEffect, useSyncExternalStore } from "react";
import type { HarnessEvent } from "../../harness/events";
import type { Keymap } from "../../harness/keymap";
import { defineVariant, type VariantProps } from "../../harness/registry";

const schema = {
  size: { value: 14, min: 10, max: 32, step: 1, label: "font size" },
  showCounts: { value: true, label: "show item counts" },
};

function Hello({ knobs, store, keymap, emit }: VariantProps<typeof schema>) {
  useSyncExternalStore(store.subscribe, () => store.revision);
  useBinding(keymap, emit);
  return (
    <div style={{ padding: "1rem", fontSize: knobs.size }}>
      <p>
        The store holds {store.sources().length} source(s). Press <kbd>C-h</kbd> to log an event.
      </p>
      <ul>
        {store.sources().map((source) => (
          <li key={source.origin}>
            {source.title} <small>{source.level === "l0" ? "(plain RSS, not quotable)" : ""}</small>
            {knobs.showCounts && <small> {store.items(source.origin).length} items</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useBinding(keymap: Keymap, emit: (event: HarnessEvent) => void) {
  useEffect(
    () => keymap.bind("C-h", "log a hello event", () => emit({ type: "drag.cancel", kind: "whole", reason: "hello" })),
    [keymap, emit],
  );
}

export default defineVariant({
  id: "hello",
  name: "hello",
  description: "The smallest variant: a knob, the store, a key binding, an event.",
  knobs: schema,
  Component: Hello,
});
