// @runtime dev
// App-Schema für `kumiko schema generate`. Sammelt alle EntityDefinitions
// + Unmanaged-Tables die in der App laufen, gibt sie als EntityTableMeta[]
// zurück. CLI importiert ENTITY_METAS via dynamic-import.
//
// **Convention:** dieses File muss `export const ENTITY_METAS:
// readonly EntityTableMeta[]` haben. CLI ruft via dynamic-import auf.

import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import { collectTableMetas, type EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { APP_FEATURES } from "../src/run-config";

// collectTableMetas erfasst neben entities + unmanagedTables auch
// r.projection/r.multiStreamProjection/r.rawTable-Tabellen — dieselben
// Quellen wie der setupTestStack-auto-push (#255).
export const ENTITY_METAS: readonly EntityTableMeta[] = collectTableMetas(
  composeFeatures(APP_FEATURES, { includeBundled: true }),
);
