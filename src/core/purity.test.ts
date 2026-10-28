// src/core is pure: it imports nothing from React, the DOM, fetch, src/feeds or
// src/harness, and runs in bun and the browser alike. Two checks enforce it:
//
//   1. an import scan: core files import only other core files and the three
//      runtime-agnostic packages the design allows;
//   2. the core tsconfig, which has no DOM lib and no Node types, so a global
//      such as `document`, `window`, `fetch` or `process` does not compile.
//
// `bun run check:core` runs this file.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const coreDir = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

/** Packages core may import. Each runs unchanged in a browser, bun and node. */
const ALLOWED_PACKAGES = new Set(["markdown-it", "htmlparser2", "diff-match-patch"]);
const TEST_PACKAGES = new Set(["vitest", "node:crypto", "node:child_process", "node:fs", "node:path"]);

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

export function importsOf(source: string): string[] {
  return [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

/** Why `specifier`, imported from `file`, breaks core's boundary; `null` if it does not. */
export function violation(file: string, specifier: string, isTest: boolean): string | null {
  if (specifier.startsWith(".")) {
    const target = resolve(dirname(file), specifier);
    return target === coreDir || target.startsWith(coreDir + "/") ? null : `reaches outside src/core (${relative(coreDir, target)})`;
  }
  if (ALLOWED_PACKAGES.has(specifier) || (isTest && TEST_PACKAGES.has(specifier))) return null;
  return `imports "${specifier}", which core may not`;
}

describe("src/core purity", () => {
  // This file is the scanner: its own regexp and samples are not imports. It imports vitest and node:* only.
  const files = readdirSync(coreDir).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts") && name !== "purity.test.ts");

  it("imports only core files and the allowed runtime-agnostic packages", () => {
    const found: string[] = [];
    for (const name of files) {
      const file = join(coreDir, name);
      for (const specifier of importsOf(readFileSync(file, "utf8"))) {
        const why = violation(file, specifier, name.endsWith(".test.ts"));
        if (why) found.push(`${name}: ${why}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("notices a forbidden import (the check is not vacuous)", () => {
    // Built at runtime, so that this file's own text holds no import to flag.
    const statement = (keyword: string, specifier: string) => `${keyword} x from "${specifier}";`;
    const source = [
      statement("import", "react"),
      statement("import", "../feeds/surface"),
      statement("export", "./ids"),
      `const d = await ${"import"}("react-dom");`,
    ].join("\n");
    const file = join(coreDir, "x.ts");
    expect(importsOf(source).map((s) => violation(file, s, false))).toEqual([
      'imports "react", which core may not',
      "reaches outside src/core (../feeds/surface)",
      null,
      'imports "react-dom", which core may not',
    ]);
  });

  it("compiles without the DOM lib or Node types", () => {
    expect(() =>
      execFileSync(process.execPath, ["x", "tsc", "-p", join(coreDir, "tsconfig.json"), "--noEmit"], { cwd: coreDir, stdio: "pipe" }),
    ).not.toThrow();
  });
});
