// The registry: every variant under src/variants/*/index.tsx, found by a glob,
// so adding a variant touches nothing else. The contract is in variant.ts.

import type { Variant } from "./variant";

const modules = import.meta.glob<{ default: Variant }>("../variants/*/index.tsx", { eager: true });

export const variants: Variant[] = Object.values(modules)
  .map((module) => module.default)
  .sort((a, b) => a.id.localeCompare(b.id));

export const variantById = (id: string | null): Variant | undefined => variants.find((variant) => variant.id === id);
