import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contentHash, sha256Hex, utf8 } from "./hash";

const reference = (text: string) => "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");

describe("content_hash (§5.1)", () => {
  it("matches the published test vectors", () => {
    expect(sha256Hex(utf8(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(utf8("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("agrees with node:crypto across padding boundaries", () => {
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const text = "x".repeat(length);
      expect(contentHash(text)).toBe(reference(text));
    }
  });

  it("agrees with node:crypto on multi-byte text, astral characters and CRLF", () => {
    for (const text of ["café — “quoted”", "𝔘𝔫𝔦𝔠𝔬𝔡𝔢 and 🙂", "line\r\nline\r\n", "\u0000\u007f\u0080߿ࠀ￿"]) {
      expect(contentHash(text)).toBe(reference(text));
    }
  });

  it("replaces a lone surrogate with U+FFFD, as TextEncoder does", () => {
    expect(contentHash("a\ud800b")).toBe(reference("a\ud800b"));
    expect(contentHash("a\udc00")).toBe(reference("a\udc00"));
  });

  it("covers content_md only and prefixes the algorithm", () => {
    expect(contentHash("hello")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
