// Live ENTITY_METAS source for `kumiko schema generate|apply|status`.
//
// Computes table-metas from the SAME composeFeatures(APP_FEATURES) the
// runtime sees (runProdApp/runDevApp) — migration and runtime cannot drift.

import { collectTableMetas, type EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { APP_FEATURES, HAS_AUTH } from "../src/run-config";

export const FEATURES: readonly FeatureDefinition[] = composeFeatures([...APP_FEATURES], {
  includeBundled: HAS_AUTH,
});

export const ENTITY_METAS: readonly EntityTableMeta[] = collectTableMetas(FEATURES);
