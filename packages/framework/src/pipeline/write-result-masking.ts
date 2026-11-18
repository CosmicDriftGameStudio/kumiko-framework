import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { filterReadFields } from "../engine/field-access.ts";
import type { SessionUser } from "../engine/types/index.ts";

import type { BatchCommand, BatchResult, DispatchContext } from "./dispatch-shared.ts";
import { isLifecycleResult } from "./dispatcher-utils.ts";

type EntityLookup = Pick<DispatchContext["registry"], "getHandlerEntity" | "getEntity">;

const MAX_NESTED_EVENT_STRIP_DEPTH = 8;

// A handler may nest an executor result in its own data (`{ created: inner.data }`); the
// echoed event inside it carries plaintext PII and must not reach the response either.
// Returns the input unchanged when nothing was stripped.
function stripNestedEchoedEvents(value: unknown, depth = 0): unknown {
  if (depth > MAX_NESTED_EVENT_STRIP_DEPTH) return value;
  if (Array.isArray(value)) {
    const items = value.map((item) => stripNestedEchoedEvents(item, depth + 1));
    return items.some((item, index) => item !== value[index]) ? items : value;
  }
  if (!isPlainObject(value)) return value;
  const isNestedLifecycle = isLifecycleResult(value) && "event" in value;
  let changed = isNestedLifecycle;
  const entries = Object.entries(value).flatMap(([key, child]): [string, unknown][] => {
    if (isNestedLifecycle && key === "event") return [];
    const stripped = stripNestedEchoedEvents(child, depth + 1);
    if (stripped !== child) changed = true;
    return [[key, stripped]];
  });
  return changed ? Object.fromEntries(entries) : value;
}

// The echoed event carries plaintext entity data; only hooks and projections may read it. The rest
// is filtered like a query answer, so a save cannot read back a field the writer may not read.
function maskLifecycleOrRow(
  entity: EntityDefinition | undefined,
  data: unknown,
  user: SessionUser,
): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return stripNestedEchoedEvents(data);
  }
  if (!isLifecycleResult(data)) {
    const row = stripNestedEchoedEvents(data);
    return entity && isPlainObject(row) ? filterReadFields(entity, row, user) : row;
  }
  const { event: _event, ...lifecycle } = data;
  if (!entity) return lifecycle;
  if (lifecycle.kind === "save") {
    return {
      ...lifecycle,
      data: filterReadFields(entity, lifecycle.data, user),
      changes: filterReadFields(entity, lifecycle.changes, user, lifecycle.data),
      previous: filterReadFields(entity, lifecycle.previous, user),
    };
  }
  return { ...lifecycle, data: filterReadFields(entity, lifecycle.data, user) };
}

// Copy-on-mask: the original results still feed postSaveBatch hooks, which
// need the plaintext. Only what leaves the dispatcher is masked.
export function maskWriteResultForClient(
  registry: EntityLookup,
  handlerType: string,
  result: WriteResult,
  user: SessionUser,
): WriteResult {
  if (!result.isSuccess) return result;
  const { lifecycle, ...clientResult } = result;
  const entityName = registry.getHandlerEntity(handlerType);
  const entity = entityName ? registry.getEntity(entityName) : undefined;
  const data = maskLifecycleOrRow(entity, result.data, user);
  return data === result.data && lifecycle === undefined ? result : { ...clientResult, data };
}

export function maskBatchResultForClient(
  registry: EntityLookup,
  commands: readonly BatchCommand[],
  batch: BatchResult,
  user: SessionUser,
): BatchResult {
  const results = batch.results.map((result, index) => {
    const command = commands[index];
    return command ? maskWriteResultForClient(registry, command.type, result, user) : result;
  });
  return { ...batch, results };
}
