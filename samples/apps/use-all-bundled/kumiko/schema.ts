// @runtime dev
// App-Schema für die `kumiko-schema`-CLI (generate | validate). Komponiert die
// App-Features einmal und leitet beide CLI-Inputs ab. CLI importiert via
// dynamic-import.
//
// **Convention:** dieses File exportiert
//   - `ENTITY_METAS: readonly EntityTableMeta[]`  (Pflicht — generate + validate)
//   - `FEATURES: readonly FeatureDefinition[]`    (optional — aktiviert
//     `kumiko-schema validate`s validateBoot-Layer; ohne wird er übersprungen)

import { collectTableMetas, type EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { APP_FEATURES } from "../src/run-config";

export const FEATURES: readonly FeatureDefinition[] = composeFeatures(APP_FEATURES, {
  includeBundled: true,
});

// collectTableMetas erfasst neben entities auch
// r.projection/r.multiStreamProjection/r.storeTable-Tabellen — dieselben
// Quellen wie der setupTestStack-auto-push (#255).
export const ENTITY_METAS: readonly EntityTableMeta[] = collectTableMetas(FEATURES);
