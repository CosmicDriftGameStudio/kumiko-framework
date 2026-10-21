// Minimal Drizzle schema barrel (framework infrastructure only, no auth).
//
// Apps WITHOUT an auth stack (anonymous-only, embedded demos, headless APIs)
// need only the framework infrastructure tables — event store and
// pipeline state. Use in drizzle/schema.ts:
//
//   export * from "@cosmicdrift/kumiko-dev-server/drizzle-tables-minimal";
//   export * from "./schema.generated";   // App-specific entity tables
//
// To include auth tables, use drizzle-tables-auth-mode (includes Minimal
// plus bundle tables for config, tenant, user, and sessions).

export {
  archivedStreamsTable,
  eventsTable,
  snapshotsTable,
  upcasterDeadLetterTable,
} from "@cosmicdrift/kumiko-framework/event-store";
export {
  eventConsumerStateTable,
  projectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
