// @runtime dev
// App schema for `kumiko-schema` (validate | generate). Same compose path as
// runtime boot — see src/run-config.ts.

import { collectTableMetas, type EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { APP_FEATURES, HAS_AUTH } from "../src/run-config";

export const FEATURES: readonly FeatureDefinition[] = composeFeatures([...APP_FEATURES], {
  includeBundled: HAS_AUTH,
});

export const ENTITY_METAS: readonly EntityTableMeta[] = collectTableMetas(FEATURES);
