import type { VariantSpec } from "@cosmicdrift/kumiko-types/derivatives-types";

export const thumb = { maxEdge: 160, fit: "cover", format: "webp" } as const satisfies VariantSpec;
export const card = { maxEdge: 640, fit: "inside", format: "webp" } as const satisfies VariantSpec;
export const hero = { maxEdge: 1600, fit: "inside", format: "webp" } as const satisfies VariantSpec;
export const full = { maxEdge: 2560, fit: "inside", format: "webp" } as const satisfies VariantSpec;

// Single source of truth for the 4 preset variant names — the public
// variant route (#1951) validates its `:variant` path param against this
// list BEFORE any DB lookup or systemQuery dispatch, and the query
// handler's Zod schema enums against it too. Keep in sync with the
// preset exports above.
export const PRESET_VARIANT_NAMES = ["thumb", "card", "hero", "full"] as const;
