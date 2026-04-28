// Drizzle-Schema-Barrel: Framework-Infrastruktur-Tables.
//
// Re-exportiert die Framework-eigenen Tables (Event-Store + Pipeline-State)
// die jede App in der DB haben muss. App-Author schreibt:
//
//   // drizzle/schema.ts
//   export * from "@kumiko/dev-server/drizzle-tables-auth-mode";
//   export * from "./schema.generated";   // App-eigene + Bundle-Entity-Tables
//
// drizzle-kit sucht im schema-Module nur nach pgTable-Instances und
// ignoriert alle anderen exports — `export *` ist hier sicher.
//
// Bundle-Entity-Tables (configValuesTable, tenantTable, userTable,
// userSessionTable, tenantMembershipsTable etc.) sind bewusst NICHT hier:
// sie kommen über schema.generated.ts via buildDrizzleTable aus den
// r.entity()-Definitionen, das ist seit der entity.indexes-API die
// Single-Source-of-Truth. Doppelte Re-Exports würden zwei pgTable-
// Instances mit identischem Index-Namen erzeugen — drizzle-kit warnt.
//
// (Datei-Name "auth-mode" ist historisch — heute ist der Inhalt reine
// Framework-Infra. Umbenennen ist breaking change für App-Imports.)

// Framework-Infra (immer da, unabhängig von Features)
export { archivedStreamsTable, eventsTable, snapshotsTable } from "@kumiko/framework/event-store";
export { eventConsumerStateTable, projectionStateTable } from "@kumiko/framework/pipeline";
