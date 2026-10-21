// Drizzle schema barrel: framework infrastructure tables.
//
// Re-exports the framework-owned tables (event store + pipeline state)
// that every app must have in its database. The app author writes:
//
//   // drizzle/schema.ts
//   export * from "@cosmicdrift/kumiko-dev-server/drizzle-tables-auth-mode";
//   export * from "./schema.generated";   // App-owned + bundle entity tables
//
// drizzle-kit only looks for pgTable instances in the schema module and
// ignores all other exports — `export *` is safe here.
//
// Bundle entity tables (configValuesTable, tenantTable, userTable,
// userSessionTable, tenantMembershipsTable, etc.) are intentionally NOT here:
// they come through schema.generated.ts via buildEntityTable from the
// r.entity() definitions, which has been the single source of truth since the
// entity.indexes API. Duplicate re-exports would create two pgTable instances
// with identical index names, causing a drizzle-kit warning.
//
// The file name "auth-mode" is historical — its contents are now purely
// framework infrastructure. Renaming it would be a breaking change for app
// imports.

// Framework infrastructure (always present, regardless of features)
export {
  archivedStreamsTable,
  eventsTable,
  snapshotsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
export {
  eventConsumerStateTable,
  projectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
