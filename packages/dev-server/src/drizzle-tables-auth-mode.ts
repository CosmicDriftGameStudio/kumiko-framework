// Drizzle-Schema-Barrel: Standard-Auth-Mode.
//
// Apps die das Standard-Auth-Setup nutzen (Config + Tenant + User +
// Auth-Email-Password) bekommen die Framework-Infra-Tables in einer Zeile:
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
//   Bundle-Entity-Tables (configValuesTable, tenantTable, userTable,
//   userSessionTable, tenantMembershipsTable etc.) kommen über
//   schema.generated.ts via buildDrizzleTable aus den r.entity()-
//   Definitionen — die sind die Single-Source-of-Truth seit Welle 2 +
//   entity.indexes-API. Würden sie hier doppelt re-exportiert, ergäben
//   sich entweder ESM-Namens-Kollisionen oder duplicate-Index-Warnungen
//   im drizzle-kit (zwei pgTable-Instances mit identischem Index-Namen).
//
//   Auth-Mode bedeutet damit heute: Framework-Infra-Tables. Apps deren
//   Feature-Liste die entsprechenden Bundles enthält, bekommen die
//   Bundle-Tables automatisch über schema.generated.ts.

// Framework-Infra (immer da, unabhängig von Features)
export { archivedStreamsTable, eventsTable, snapshotsTable } from "@kumiko/framework/event-store";
export { eventConsumerStateTable, projectionStateTable } from "@kumiko/framework/pipeline";
