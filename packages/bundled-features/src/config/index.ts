import type { DbConnection, EncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import { seedConfigValues } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { configValueEntity, configValuesTable } from "./table";

export {
  CONFIG_FEATURE,
  ConfigErrors,
  ConfigHandlers,
  ConfigQueries,
} from "./constants";
export type { ConfigContext } from "./feature";
export {
  createConfigAccessor,
  createConfigAccessorFactory,
  createConfigFeature,
} from "./feature";
export type { ReadinessMissingKey, RequiredKeyGate } from "./handlers/readiness.query";
export {
  buildProviderSelectionGate,
  collectMissingRequiredConfig,
} from "./handlers/readiness.query";
export type { AppConfigOverrides, ConfigResolver } from "./resolver";
export { createConfigResolver, validateAppOverrides } from "./resolver";
export { configValuesTable } from "./table";

// Boot helper for runDevApp / runProdApp: pulls every ConfigSeedDef from
// the registry and writes the matching system/tenant/user rows via the
// event-store executor. Idempotent across boots — see config-seeding.md.
export function seedAllConfigValues(
  registry: Registry,
  db: DbConnection,
  encryption?: EncryptionProvider,
): Promise<{ created: number; skipped: number }> {
  const seeds = registry.getAllConfigSeeds();
  return seedConfigValues(seeds, configValuesTable, configValueEntity, registry, db, encryption);
}
