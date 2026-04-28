// Drizzle-Schema-Barrel: Standard-Auth-Mode.
//
// Apps die das Standard-Auth-Setup nutzen (Config + Tenant + User +
// Auth-Email-Password) bekommen die Framework-Infra-Tables und die
// Custom-Bundle-Tables (NICHT-Entity-Tables wie configValuesTable und
// tenantMembershipsTable) in einer Zeile:
//
//   // drizzle/schema.ts
//   export * from "@kumiko/dev-server/drizzle-tables-auth-mode";
//   export * from "./schema.generated";   // App-eigene + Bundle-Entity-Tables
//
// drizzle-kit sucht im schema-Module nur nach pgTable-Instances und
// ignoriert alle anderen exports — `export *` ist hier sicher.
//
// WICHTIG — was NICHT hier exportiert wird:
//
//   Entity-Tables aus Bundle-Features (tenantTable, userTable,
//   userSessionTable etc.) kommen über schema.generated.ts via
//   buildDrizzleTable aus den r.entity()-Definitionen. Würden sie hier
//   doppelt re-exportiert, ergäben sich ESM-Namens-Kollisionen + drizzle-
//   kit-Drift-Warnungen.
//
//   Wer NICHT alle Bundle-Custom-Tables in der DB will, nutzt
//   drizzle-tables-minimal (nur Framework-Infra) und re-exportiert
//   gezielt das was er wirklich braucht.

// Bundle-Custom-Tables für Standard-Auth-Mode
//
// (KEINE Entity-Tables — die kommen über r.entity() in schema.generated.ts)
export { configValuesTable } from "@kumiko/bundled-features/config";
export { tenantMembershipsTable } from "@kumiko/bundled-features/tenant";
// Framework-Infra (immer da, unabhängig von Features)
export { archivedStreamsTable, eventsTable, snapshotsTable } from "@kumiko/framework/event-store";
export { eventConsumerStateTable, projectionStateTable } from "@kumiko/framework/pipeline";
