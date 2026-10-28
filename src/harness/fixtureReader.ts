// Fixtures in the browser: Vite turns each JSON file into a lazily imported
// module. (Under bun, tests read the same files from disk.)

import type { Reader } from "../feeds/fixtures";

const files = import.meta.glob("../../fixtures/**/*.json", { import: "default" }) as Record<string, () => Promise<unknown>>;

export const readFixture: Reader = async (path) => {
  const load = files[`../../fixtures/${path}`];
  if (!load) throw new Error(`no fixture at fixtures/${path}`);
  return load();
};
