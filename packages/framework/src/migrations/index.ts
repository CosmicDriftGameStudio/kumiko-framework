// Drizzle-free gate (kumiko/migrations system) — the canonical boot-gate.
export {
  assertKumikoSchemaCurrent,
  type ChecksumMismatch,
  detectKumikoDrift,
  formatKumikoDriftReport,
  type KumikoDriftReport,
  SchemaDriftError,
} from "./kumiko-drift";
// tableName → projection-name, für den app-seitigen Projection-Rebuild.
export { buildProjectionTableIndex } from "./projection-table-index";
