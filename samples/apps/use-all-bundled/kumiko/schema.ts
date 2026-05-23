// @runtime dev
// App-Schema für `kumiko schema generate`. Sammelt alle EntityDefinitions
// + Unmanaged-Tables die in der App laufen, gibt sie als EntityTableMeta[]
// zurück. CLI importiert ENTITY_METAS via dynamic-import.
//
// **Convention:** dieses File muss `export const ENTITY_METAS:
// readonly EntityTableMeta[]` haben. CLI ruft via dynamic-import auf.

import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import { buildEntityTableMeta, type EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { APP_FEATURES } from "../src/run-config";

function collectMetas(): readonly EntityTableMeta[] {
  const composed = composeFeatures(APP_FEATURES, { includeBundled: true });
  const metas: EntityTableMeta[] = [];

  for (const feature of composed) {
    for (const [name, ent] of Object.entries(feature.entities ?? {})) {
      metas.push(buildEntityTableMeta(name, ent, { relations: feature.relations?.[name] }));
    }
    for (const entry of Object.values(feature.unmanagedTables ?? {})) {
      metas.push(entry.meta);
    }
  }

  return metas;
}

export const ENTITY_METAS: readonly EntityTableMeta[] = collectMetas();
