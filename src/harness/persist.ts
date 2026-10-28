// localStorage, for per-viewer conveniences only (knob values, the draft, the
// last variant). It can be absent or throw (private windows, blocked storage),
// so every access is guarded and nothing depends on it.

export function readJson<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable or full: carry on without it
  }
}
