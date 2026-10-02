import { maskWriteOnlyFields } from "../engine/field-access.js";
import type { EntityDefinition, WriteResult } from "../engine/types/index.js";
import type { BatchCommand, BatchResult, DispatchContext } from "./dispatch-shared.js";
import { isLifecycleResult } from "./dispatcher-utils.js";

type EntityLookup = Pick<DispatchContext["registry"], "getHandlerEntity" | "getEntity">;

function maskLifecycleOrRow(entity: EntityDefinition, data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  if (!isLifecycleResult(data)) return maskWriteOnlyFields(entity, data as Record<string, unknown>); // @cast-boundary engine-payload
  if (data.kind === "save") {
    return {
      ...data,
      data: maskWriteOnlyFields(entity, data.data),
      changes: maskWriteOnlyFields(entity, data.changes),
      previous: maskWriteOnlyFields(entity, data.previous),
    };
  }
  return { ...data, data: maskWriteOnlyFields(entity, data.data) };
}

// Copy-on-mask: the original results still feed postSaveBatch hooks, which
// need the plaintext. Only what leaves the dispatcher is masked.
export function maskWriteResultForClient(
  registry: EntityLookup,
  handlerType: string,
  result: WriteResult,
): WriteResult {
  if (!result.isSuccess) return result;
  const entityName = registry.getHandlerEntity(handlerType);
  const entity = entityName ? registry.getEntity(entityName) : undefined;
  if (!entity) return result;
  const data = maskLifecycleOrRow(entity, result.data);
  return data === result.data ? result : { ...result, data };
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
