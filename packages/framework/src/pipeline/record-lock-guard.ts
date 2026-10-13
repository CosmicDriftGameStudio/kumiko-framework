import { evalFieldCondition } from "../engine/screen-helpers.js";
import type { LifecycleResult, Registry } from "../engine/types/index.js";
import { RecordLockedError } from "../errors/index.js";

// Runs on the handler's result, not on its payload: custom handlers name the
// record in arbitrary payload shapes, but every save/delete result carries the
// stored state, so one check covers CRUD, custom and nested ctx.write handlers.
// Throwing here rolls the surrounding transaction back, event append included.
export function assertRecordNotLocked(registry: Registry, result: LifecycleResult): void {
  // skip: results of unnamed aggregates have no entity to lock
  if (result.entityName === undefined) return;
  const lockedWhen = registry.getEntity(result.entityName)?.lockedWhen;
  // skip: the entity declares no lock
  if (lockedWhen === undefined) return;
  const storedState = storedStateOf(result);
  // skip: a create has no stored state yet
  if (storedState === undefined) return;
  if (evalFieldCondition(lockedWhen, storedState)) {
    throw new RecordLockedError({ entityName: result.entityName, entityId: result.id });
  }
}

function storedStateOf(result: LifecycleResult): Readonly<Record<string, unknown>> | undefined {
  if (result.kind === "delete") return result.data;
  return result.isNew ? undefined : result.previous;
}
