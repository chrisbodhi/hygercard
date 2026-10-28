import { describe, expect, it } from "vitest";
import { encodeId, ID_ALPHABET, isValidId, newId } from "./ids";

describe("ids (§5.1)", () => {
  it("encodes 128 bits as 26 characters, big-endian", () => {
    expect(encodeId(new Uint8Array(16))).toBe("0".repeat(26));
    expect(encodeId(new Uint8Array(16).fill(255))).toBe("7" + "z".repeat(25));
  });

  it("generated ids are valid, and the top character is 0-7", () => {
    for (let i = 0; i < 200; i++) {
      const id = newId();
      expect(isValidId(id)).toBe(true);
      expect(Number.parseInt(id[0]!, 32)).toBeLessThanOrEqual(7);
    }
  });

  it("accepts the injected randomness source", () => {
    const id = newId((bytes) => bytes.fill(1));
    expect(id).toBe(encodeId(new Uint8Array(16).fill(1)));
  });

  it("rejects wrong length, uppercase, and the letters Crockford drops", () => {
    expect(isValidId("0".repeat(25))).toBe(false);
    expect(isValidId("0".repeat(27))).toBe(false);
    expect(isValidId("A".repeat(26))).toBe(false);
    for (const letter of "ilou") expect(ID_ALPHABET.includes(letter)).toBe(false);
    expect(isValidId("i".repeat(26))).toBe(false);
    expect(isValidId(undefined)).toBe(false);
    expect(isValidId(123)).toBe(false);
  });

  it("accepts real ids", () => {
    expect(isValidId("7c9wk2mhq0v3xj8tn5rzfd41bg")).toBe(true);
    expect(isValidId("1vgtgz0gq5b2c9k7d3m8r4n6xy")).toBe(true);
  });
});
