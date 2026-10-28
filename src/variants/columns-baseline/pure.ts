// The variant's pure helpers, kept out of the components so bun can test them.

/** The index of the boundary zone whose centre is nearest `y`. There is always at least one zone. */
export function nearestBoundary(centres: readonly number[], y: number): number {
  let best = 0;
  for (let i = 1; i < centres.length; i++) {
    if (Math.abs(centres[i]! - y) < Math.abs(centres[best]! - y)) best = i;
  }
  return best;
}

/** Which lines of `to` differ from `from`: everything between the common head and the common tail. */
export function changedLines(from: string, to: string): { start: number; end: number } {
  const a = from.split("\n");
  const b = to.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { start: head, end: b.length - tail };
}

/** A short, one-line excerpt for a drag ghost. */
export function excerpt(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const characters = Array.from(flat);
  return characters.length <= limit ? flat : characters.slice(0, limit).join("").trimEnd() + "…";
}
