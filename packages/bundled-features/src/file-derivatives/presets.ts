import type { VariantSpec } from "@cosmicdrift/kumiko-types/derivatives-types";

export const thumb = { maxEdge: 160, fit: "cover", format: "webp" } as const satisfies VariantSpec;
export const card = { maxEdge: 640, fit: "inside", format: "webp" } as const satisfies VariantSpec;
export const hero = { maxEdge: 1600, fit: "inside", format: "webp" } as const satisfies VariantSpec;
export const full = { maxEdge: 2560, fit: "inside", format: "webp" } as const satisfies VariantSpec;
