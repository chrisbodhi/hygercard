// A keymap registry in Emacs notation: `C-/`, `C-?`, `M-x`, `C-x u`, `<left>`,
// `RET`. Modifiers are C- (control), M- (alt/option), S- (shift), s- (command).
//
// Shift is part of a printable character, as in Emacs: `C-?` is control plus the
// key that types `?`, so it is written without `S-`. `S-` appears only on named
// keys (`S-<tab>`) and on letters combined with C- or M- (`C-S-a`).

export type Handler = (event: KeyboardEvent) => void;

export interface Binding {
  /** Canonical form: modifiers in the order C M S s, keys separated by spaces. */
  sequence: string;
  description: string;
  handler: Handler;
}

const NAMED: Record<string, string> = {
  Enter: "RET", " ": "SPC", Escape: "ESC", Tab: "<tab>", Backspace: "DEL",
  ArrowLeft: "<left>", ArrowRight: "<right>", ArrowUp: "<up>", ArrowDown: "<down>",
  Delete: "<delete>", Home: "<home>", End: "<end>", PageUp: "<prior>", PageDown: "<next>",
};
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"]);

/** One key stroke of an event in Emacs notation, or `null` for a bare modifier. */
export function describeEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  let key = NAMED[event.key] ?? event.key;
  // Option rewrites the character on macOS; the physical key is what M- means.
  if (event.altKey) {
    const physical = /^Key([A-Z])$/.exec(event.code)?.[1]?.toLowerCase() ?? /^Digit(\d)$/.exec(event.code)?.[1];
    if (physical) key = event.shiftKey && !event.ctrlKey ? physical.toUpperCase() : physical;
  }
  const printable = key.length === 1;
  const isLetter = printable && key.toLowerCase() !== key.toUpperCase();
  let shift = false;
  if (event.shiftKey) {
    if (!printable) shift = true;
    else if (isLetter && (event.ctrlKey || event.altKey)) {
      shift = true;
      key = key.toLowerCase();
    }
  }
  return (event.ctrlKey ? "C-" : "") + (event.altKey ? "M-" : "") + (shift ? "S-" : "") + (event.metaKey ? "s-" : "") + key;
}

/** Put a hand-written stroke or sequence into canonical form. */
export function canonical(sequence: string): string {
  return sequence
    .trim()
    .split(/\s+/)
    .map((stroke) => {
      let rest = stroke;
      const mods = new Set<string>();
      for (let m = /^([CMSs])-(?=.)/.exec(rest); m; m = /^([CMSs])-(?=.)/.exec(rest)) {
        mods.add(m[1]!);
        rest = rest.slice(2);
      }
      return ["C", "M", "S", "s"].filter((m) => mods.has(m)).map((m) => `${m}-`).join("") + rest;
    })
    .join(" ");
}

const PREFIX_TIMEOUT_MS = 1500;

export class Keymap {
  private bindings = new Map<string, Binding>();
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Bind a key sequence. Returns the function that removes the binding. */
  bind(sequence: string, description: string, handler: Handler): () => void {
    const key = canonical(sequence);
    const binding: Binding = { sequence: key, description, handler };
    this.bindings.set(key, binding);
    return () => {
      if (this.bindings.get(key) === binding) this.bindings.delete(key);
    };
  }

  list(): Binding[] {
    return [...this.bindings.values()].sort((a, b) => (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0));
  }

  /** Feed a key event. Returns true if it was consumed by a binding or the start of one. */
  handle(event: KeyboardEvent): boolean {
    const stroke = describeEvent(event);
    if (stroke === null) return false;
    const candidate = [...this.pending, stroke].join(" ");
    const exact = this.bindings.get(candidate);
    const isPrefix = [...this.bindings.keys()].some((key) => key.startsWith(candidate + " "));
    this.reset();
    if (exact) {
      event.preventDefault();
      exact.handler(event);
      return true;
    }
    if (isPrefix) {
      event.preventDefault();
      this.pending = candidate.split(" ");
      this.timer = setTimeout(() => this.reset(), PREFIX_TIMEOUT_MS);
      return true;
    }
    return false;
  }

  private reset() {
    this.pending = [];
    clearTimeout(this.timer);
  }

  /** Listen on a target (usually the document). Returns the function that stops listening. */
  attach(target: Pick<Document, "addEventListener" | "removeEventListener">): () => void {
    const listener = (event: Event) => this.handle(event as KeyboardEvent);
    target.addEventListener("keydown", listener);
    return () => target.removeEventListener("keydown", listener);
  }
}
