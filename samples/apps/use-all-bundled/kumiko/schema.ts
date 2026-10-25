// @runtime dev
// App schema for the `kumiko-schema` CLI (generate | validate). Composes the
// app features once and derives both CLI inputs. The CLI imports via
// dynamic import.
//
// **Convention:** this file exports
//   - `ENTITY_METAS: readonly EntityTableMeta[]`  (required — generate + validate)
//   - `FEATURES: readonly FeatureDefinition[]`    (optional — activates
//     the validateBoot layer of `kumiko-schema validate`; without it that layer is skipped)

import { collectTableMetas, type EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { BUNDLED_LISTS } from "../src/bundled-lists";
import { APP_FEATURES, AUTH_COMPOSE_OPTIONS, VALIDATE_BOOT_OPTIONS } from "../src/run-config";

export { VALIDATE_BOOT_OPTIONS };

export const FEATURES: readonly FeatureDefinition[] = composeFeatures(APP_FEATURES, {
  includeBundled: true,
  authOptions: AUTH_COMPOSE_OPTIONS,
  bundledLists: BUNDLED_LISTS,
});

// collectTableMetas erfasst neben entities auch
// r.projection/r.multiStreamProjection/r.storeTable-Tabellen — dieselben
// Quellen wie der setupTestStack-auto-push (#255).
export const ENTITY_METAS: readonly EntityTableMeta[] = collectTableMetas(FEATURES);
