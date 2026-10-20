import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { seedConfigValues } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import type { EnvelopeCipher } from "@cosmicdrift/kumiko-framework/secrets";
import { configValueEntity, configValuesTable } from "./table.ts";

export type { ConfigContext } from "./feature.ts";
export {
  createConfigAccessor,
  createConfigAccessorFactory,
  createConfigFeature,
} from "./feature.ts";
export type { ReadinessMissingKey, RequiredKeyGate } from "./handlers/readiness.query.ts";
export {
  buildProviderSelectionGate,
  collectMissingRequiredConfig,
} from "./handlers/readiness.query.ts";
export type { AppConfigOverrides, ConfigResolver } from "./resolver.ts";
export { buildEnvConfigOverrides, createConfigResolver, validateAppOverrides } from "./resolver.ts";
export { configValueEntity, configValuesTable } from "./table.ts";
export {
  CONFIG_FEATURE,
  ConfigErrors,
  ConfigHandlers,
  ConfigQueries,
} from "./web/constants.ts";

// Boot helper for runDevApp / runProdApp: pulls every ConfigSeedDef from
// the registry and writes the matching system/tenant/user rows via the
// event-store executor. Idempotent across boots — see config-seeding.md.
export function seedAllConfigValues(
  registry: Registry,
  db: DbConnection,
  cipher?: EnvelopeCipher,
): Promise<{ created: number; skipped: number }> {
  const seeds = registry.getAllConfigSeeds();
  return seedConfigValues(seeds, configValuesTable, configValueEntity, registry, db, cipher);
}
