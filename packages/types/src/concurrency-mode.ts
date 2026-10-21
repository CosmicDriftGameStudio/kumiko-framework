// Canonical source — packages/framework/src/engine/constants.ts's
// ConcurrencyModes value object is `satisfies Record<string, ConcurrencyMode>`
// against this type, so adding a mode only here (or only there) is a compile
// error instead of silent drift.
export type ConcurrencyMode = "parallel" | "skip" | "replace" | "sequential" | "debounce";
