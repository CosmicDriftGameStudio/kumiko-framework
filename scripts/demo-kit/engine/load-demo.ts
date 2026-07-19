import { join } from "node:path";
import { hydrateDemo } from "./hydrate";

const KIT_ROOT = join(import.meta.dir, "..");

/** Load a demo-kit id (e.g. `create-app`) into a runtime `DemoDef`. */
export function loadDemo(demoId: string): ReturnType<typeof hydrateDemo> {
  return hydrateDemo({ demoId, kitRoot: KIT_ROOT });
}
