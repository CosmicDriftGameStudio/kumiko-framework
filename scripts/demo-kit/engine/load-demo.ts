import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hydrateDemo } from "./hydrate";

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Load a demo-kit id (e.g. `create-app`) into a runtime `DemoDef`. */
export function loadDemo(demoId: string): ReturnType<typeof hydrateDemo> {
  return hydrateDemo({ demoId, kitRoot: KIT_ROOT });
}
