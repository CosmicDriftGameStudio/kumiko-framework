// es-ops — ES-Operations-Pattern für Kumiko-Apps.
//
// Phase 1: seed-migrations. Phase 2+ docken an dieselbe Infra an
// (kumiko_es_operations-Table mit operation_type-Discriminator).
//
// App-Author-API:
//   - SeedMigration: default-export-Typ einer seed-file
//   - runProdApp({ seedsDir }): Framework runs pending bei Boot
//   - bunx kumiko ops seed:new|status|apply (CLI)
//
// Plan-Doc: kumiko-platform/docs/plans/features/es-ops.md

export {
  type CreateSeedMigrationContextArgs,
  createSeedMigrationContext,
} from "./context";
export {
  createEsOperationsTable,
  type EsOperationAppliedBy,
  type EsOperationType,
  esOperationsTable,
} from "./operations-schema";
export {
  type RunPendingSeedMigrationsArgs,
  type RunPendingSeedMigrationsResult,
  runPendingSeedMigrations,
} from "./runner";
export type {
  SeedMembershipRow,
  SeedMigration,
  SeedMigrationContext,
  SeedTenantRow,
  SeedUserRow,
} from "./types";
