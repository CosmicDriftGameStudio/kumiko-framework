import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { maskWriteOnlyFields } from "../engine/field-access.ts";

import type { BatchCommand, BatchResult, DispatchContext } from "./dispatch-shared.ts";
import { isLifecycleResult } from "./dispatcher-utils.ts";

type EntityLookup = Pick<DispatchContext["registry"], "getHandlerEntity" | "getEntity">;

// The echoed event carries plaintext entity data; only hooks and projections may read it.
function maskLifecycleOrRow(entity: EntityDefinition | undefined, data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  if (!isLifecycleResult(data)) {
    return entity ? maskWriteOnlyFields(entity, data as Record<string, unknown>) : data; // @cast-boundary engine-payload
  }
  const { event: _event, ...lifecycle } = data;
  if (!entity) return lifecycle;
  if (lifecycle.kind === "save") {
    return {
      ...lifecycle,
      data: maskWriteOnlyFields(entity, lifecycle.data),
      changes: maskWriteOnlyFields(entity, lifecycle.changes),
      previous: maskWriteOnlyFields(entity, lifecycle.previous),
    };
  }
  return { ...lifecycle, data: maskWriteOnlyFields(entity, lifecycle.data) };
}

// Copy-on-mask: the original results still feed postSaveBatch hooks, which
// need the plaintext. Only what leaves the dispatcher is masked.
export function maskWriteResultForClient(
  registry: EntityLookup,
  handlerType: string,
  result: WriteResult,
): WriteResult {
  if (!result.isSuccess) return result;
  const { lifecycle, ...clientResult } = result;
  const entityName = registry.getHandlerEntity(handlerType);
  const entity = entityName ? registry.getEntity(entityName) : undefined;
  const data = maskLifecycleOrRow(entity, result.data);
  return data === result.data && lifecycle === undefined ? result : { ...clientResult, data };
}

export function maskBatchResultForClient(
  registry: EntityLookup,
  commands: readonly BatchCommand[],
  batch: BatchResult,
): BatchResult {
  const results = batch.results.map((result, index) => {
    const command = commands[index];
    return command ? maskWriteResultForClient(registry, command.type, result) : result;
  });
  return { ...batch, results };
}
