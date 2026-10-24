// es-ops — ES operations pattern for Kumiko apps.
//
// Seed migrations use the same infrastructure as later operation types
// (the `kumiko_es_operations` table with an `operation_type` discriminator).
//
// App author API:
//   - `SeedMigration`: default export type of a seed file
//   - `runProdApp({ seedsDir })`: the framework runs pending migrations at boot
//   - `bunx kumiko ops seed:new|status|apply` (CLI)

export { createSeedMigrationContext } from "./context.ts";
export {
  createEsOperationsTable,
  esOperationsTable,
} from "./operations-schema.ts";
export { runPendingSeedMigrations } from "./runner.ts";
export type {
  SeedMigration,
  SeedMigrationContext,
} from "./types.ts";
