import type { VariantSpec } from "@cosmicdrift/kumiko-types/derivatives-types";

// Ready-made specs to spread into a field's own `variants` declaration
// (`createImageField({ variants: { thumb, full: { ...full, maxEdge: 4096 } } })`)
// — not an allow-list. Which names a route serves is decided entirely by
// what a field declares (#1985), these are just common defaults.
export const thumb = { maxEdge: 160, fit: "cover", format: "webp" } as const satisfies VariantSpec;
export const card = { maxEdge: 640, fit: "inside", format: "webp" } as const satisfies VariantSpec;
export const hero = { maxEdge: 1600, fit: "inside", format: "webp" } as const satisfies VariantSpec;
export const full = { maxEdge: 2560, fit: "inside", format: "webp" } as const satisfies VariantSpec;
