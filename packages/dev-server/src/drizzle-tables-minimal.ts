// Drizzle-Schema-Barrel: Minimal (nur Framework-Infra, kein Auth).
//
// Apps OHNE Auth-Stack (anonymous-only, embedded Demos, Headless-APIs)
// brauchen nur die Framework-Infrastructure-Tables — Event-Store +
// Pipeline-State. Verwendung in drizzle/schema.ts:
//
//   export * from "@cosmicdrift/kumiko-dev-server/drizzle-tables-minimal";
//   export * from "./schema.generated";   // App-eigene Entity-Tables
//
// Wer Auth-Tables will, nutzt drizzle-tables-auth-mode (umfasst Minimal
// plus Bundle-Tables für Config, Tenant, User, Sessions).

export {
  archivedStreamsTable,
  eventsTable,
  snapshotsTable,
  upcasterDeadLetterTable,
} from "@cosmicdrift/kumiko-framework/event-store";
export { eventConsumerStateTable, projectionStateTable } from "@cosmicdrift/kumiko-framework/pipeline";
