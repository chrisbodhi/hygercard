// The variant contract. A variant is a folder under src/variants/ whose
// index.tsx default-exports `defineVariant({...})`. This module is what variants
// import; the registry, which finds them, is a separate module so that the two
// do not import each other.

import type { ComponentType } from "react";
import type { Store } from "../core/store";
import type { HarnessEvent } from "./events";
import type { Keymap } from "./keymap";

/** A knob, in the shape the harness's knobs panel takes. Variants declare knobs as plain data. */
export type KnobSpec =
  | { value: number; min?: number; max?: number; step?: number; label?: string }
  | { value: boolean; label?: string }
  | { value: string; options: readonly string[]; label?: string };

export type KnobSchema = Record<string, KnobSpec>;

export type KnobValues<S extends KnobSchema> = {
  [K in keyof S]: S[K] extends { options: readonly (infer O)[] } ? O : S[K]["value"] extends number ? number : S[K]["value"] extends boolean ? boolean : string;
};

export interface VariantProps<S extends KnobSchema = KnobSchema> {
  /** Current knob values. */
  knobs: KnobValues<S>;
  /** The local snapshot store: fixtures or live data, as the harness has loaded them. */
  store: Store;
  /** Register key bindings (Emacs notation). Remove them when the variant unmounts. */
  keymap: Keymap;
  /** Append to the interaction event log. */
  emit: (event: HarnessEvent) => void;
  /** Whether the store holds live data rather than fixtures. */
  live: boolean;
}

export interface Variant<S extends KnobSchema = KnobSchema> {
  id: string;
  name: string;
  description: string;
  knobs: S;
  Component: ComponentType<VariantProps<S>>;
}

/** Type-check a variant against its own knob schema, then erase the schema for the registry. */
export function defineVariant<S extends KnobSchema>(variant: Variant<S>): Variant {
  return variant as unknown as Variant;
}

