import type { EventStoreExecutor } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { LocalKeyKmsAdapter } from "../crypto";
import type { EntityDefinition } from "../engine/types";
import type { EntityCache } from "../pipeline/entity-cache";
import type { SearchAdapter } from "../search/types";
import type { EnvelopeCipher } from "../secrets/envelope-cipher";
import { buildExecutorContext, type Table } from "./event-store-executor-context";
import { createReadVerbs } from "./event-store-executor-read";
import { createWriteVerbs } from "./event-store-executor-write";

export type { EventStoreExecutor } from "@cosmicdrift/kumiko-types/event-store-executor-types";

// The executor writes events + auto-projection (entity table) in one TX.
// It no longer knows about user projections — those are driven by the
// pipeline, which reads the StoredEvent surfaced on SaveContext/DeleteContext
// and iterates the registry itself. Executor-level `registry` options were
// removed to close the silent-bypass hole where a caller forgetting to pass
// one would skip projections without any signal.
//
// Split into three files (#1005, Welle 2): this facade holds the public
// types + the createEventStoreExecutor() factory. Context-building (crypto/
// ownership helpers shared by every verb) lives in
// event-store-executor-context.ts; the write verbs (create/update/delete/
// forget/restore) in event-store-executor-write.ts; the read verbs (list/
// detail) in event-store-executor-read.ts.

export type { EntityLifecycleVerb } from "./event-store-executor-context";
export { entityEventName } from "./event-store-executor-context";

export type EventStoreExecutorOptions = {
  searchAdapter?: SearchAdapter;
  entityName: string; // required — the aggregateType marker on every event
  entityCache?: EntityCache;
  /** Override the boot-injected cipher for fields marked `encrypted: true`. */
  encryption?: EnvelopeCipher;
  /** Override the boot-injected subject KMS for pii-annotated fields. */
  kms?: LocalKeyKmsAdapter;
};

export function createEventStoreExecutor(
  table: Table,
  entity: EntityDefinition,
  options: EventStoreExecutorOptions,
): EventStoreExecutor {
  const ctx = buildExecutorContext(table, entity, options);
  return {
    ...createWriteVerbs(ctx),
    ...createReadVerbs(ctx),
  };
}
