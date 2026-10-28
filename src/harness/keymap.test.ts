import { describe, expect, it } from "vitest";
import { canonical, describeEvent, Keymap } from "./keymap";

type FakeEvent = KeyboardEvent & { prevented: boolean };

function key(init: Partial<KeyboardEvent> & { key: string }): FakeEvent {
  const event = {
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: "", prevented: false,
    preventDefault: () => { event.prevented = true; },
    ...init,
  };
  return event as unknown as FakeEvent;
}

describe("Emacs notation", () => {
  it("describes control chords: C-/ undoes, C-? redoes (shift is part of the character)", () => {
    expect(describeEvent(key({ key: "/", ctrlKey: true }))).toBe("C-/");
    expect(describeEvent(key({ key: "?", ctrlKey: true, shiftKey: true }))).toBe("C-?");
  });

  it("writes S- on named keys and on letters combined with C- or M-, but not on plain capitals", () => {
    expect(describeEvent(key({ key: "Tab", shiftKey: true }))).toBe("S-<tab>");
    expect(describeEvent(key({ key: "A", ctrlKey: true, shiftKey: true }))).toBe("C-S-a");
    expect(describeEvent(key({ key: "A", shiftKey: true }))).toBe("A");
  });

  it("names special keys", () => {
    expect(describeEvent(key({ key: "Enter" }))).toBe("RET");
    expect(describeEvent(key({ key: " " }))).toBe("SPC");
    expect(describeEvent(key({ key: "Escape" }))).toBe("ESC");
    expect(describeEvent(key({ key: "ArrowLeft", ctrlKey: true }))).toBe("C-<left>");
    expect(describeEvent(key({ key: "Backspace" }))).toBe("DEL");
  });

  it("reads M- from the physical key, since Option rewrites the character on macOS", () => {
    expect(describeEvent(key({ key: "≈", altKey: true, code: "KeyX" }))).toBe("M-x");
  });

  it("ignores a bare modifier", () => {
    for (const modifier of ["Control", "Shift", "Alt", "Meta"]) expect(describeEvent(key({ key: modifier }))).toBeNull();
  });

  it("canonicalizes the modifier order and sequences", () => {
    expect(canonical("S-C-a")).toBe("C-S-a");
    expect(canonical("M-C-x")).toBe("C-M-x");
    expect(canonical("  C-x    u ")).toBe("C-x u");
    expect(canonical("C-/")).toBe("C-/");
    expect(canonical("-")).toBe("-");
  });
});

describe("Keymap", () => {
  it("runs a bound handler, consumes the event, and unbinds", () => {
    const keymap = new Keymap();
    let called = 0;
    const unbind = keymap.bind("C-/", "undo", () => called++);
    const event = key({ key: "/", ctrlKey: true });
    expect(keymap.handle(event)).toBe(true);
    expect(event.prevented).toBe(true);
    expect(called).toBe(1);
    unbind();
    expect(keymap.handle(key({ key: "/", ctrlKey: true }))).toBe(false);
    expect(called).toBe(1);
  });

  it("leaves unbound keys alone", () => {
    const keymap = new Keymap();
    keymap.bind("C-/", "undo", () => {});
    const event = key({ key: "a" });
    expect(keymap.handle(event)).toBe(false);
    expect(event.prevented).toBe(false);
  });

  it("runs a multi-stroke sequence, swallowing the prefix", () => {
    const keymap = new Keymap();
    let called = 0;
    keymap.bind("C-x u", "undo", () => called++);
    const prefix = key({ key: "x", ctrlKey: true });
    expect(keymap.handle(prefix)).toBe(true);
    expect(prefix.prevented).toBe(true);
    expect(called).toBe(0);
    expect(keymap.handle(key({ key: "u" }))).toBe(true);
    expect(called).toBe(1);
  });

  it("a stroke that does not continue the sequence abandons it", () => {
    const keymap = new Keymap();
    let called = 0;
    keymap.bind("C-x u", "undo", () => called++);
    keymap.handle(key({ key: "x", ctrlKey: true }));
    expect(keymap.handle(key({ key: "q" }))).toBe(false);
    expect(keymap.handle(key({ key: "u" }))).toBe(false);
    expect(called).toBe(0);
  });

  it("lists bindings with their descriptions, sorted", () => {
    const keymap = new Keymap();
    keymap.bind("C-?", "redo", () => {});
    keymap.bind("C-/", "undo", () => {});
    expect(keymap.list().map((b) => [b.sequence, b.description])).toEqual([["C-/", "undo"], ["C-?", "redo"]]);
  });

  it("a later binding replaces an earlier one, and the earlier unbinder does not remove the replacement", () => {
    const keymap = new Keymap();
    const calls: string[] = [];
    const first = keymap.bind("C-a", "first", () => calls.push("first"));
    keymap.bind("C-a", "second", () => calls.push("second"));
    first();
    keymap.handle(key({ key: "a", ctrlKey: true }));
    expect(calls).toEqual(["second"]);
  });
});
