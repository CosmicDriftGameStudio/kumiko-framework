// Demo wrapper: each scripts/demos/<N>-<name>.ts file `export default demo({...})`.
// Iter 1 only validates the schema (dry-run test); Iter 2's record-demo.ts
// imports the default export and drives tmux + Playwright + ffmpeg from it.

import type { Step } from "./step";

export type DemoDef = {
  /** Unique kebab-case id. Maps to the recorder's output file name (e.g.
   *  "create-app" → apps/marketing/public/hero/create-app.gif + captions.json). */
  readonly title: string;
  /** Ordered steps. The recorder walks them sequentially; captions land in
   *  captions.json keyed by step index + cumulative timing. */
  readonly steps: readonly Step[];
};

export function demo(def: DemoDef): DemoDef {
  if (!/^[a-z][a-z0-9-]*$/.test(def.title)) {
    throw new Error(`demo: title must be kebab-case, got "${def.title}"`);
  }
  if (def.steps.length === 0) {
    throw new Error(`demo "${def.title}": at least one step required`);
  }
  return def;
}
