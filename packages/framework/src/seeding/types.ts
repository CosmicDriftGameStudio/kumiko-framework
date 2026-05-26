/** Boot-seed semantics for event-sourced entity helpers.
 *
 *  - `skip` (default): row exists → return without write (no event).
 *  - `update`: row exists → overwrite via executor.update (opt-in, e.g.
 *    demo-fixtures where code is source-of-truth). */
export type SeedIfExists = "skip" | "update";

export const DEFAULT_SEED_IF_EXISTS: SeedIfExists = "skip";
