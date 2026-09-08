// Feature list for `kumiko agent lint`. Mirrors what src/app/server.ts mounts
// so the lint sees the same registry the running app builds.

import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { demosFeature } from "./src/features/demos";
import { itemsFeature } from "./src/features/items";

export default {
  features: [localeDe(), itemsFeature, demosFeature],
};
