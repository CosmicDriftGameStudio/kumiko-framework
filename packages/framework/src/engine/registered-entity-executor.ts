import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { EventStoreExecutor } from "../db/event-store-executor.ts";
import { createEntityExecutor } from "./entity-handlers.ts";
import type { Registry } from "./types/index.ts";

// Keyed by definition identity plus name: two test stacks can register different
// EntityDefinitions under the same entity name.
const executorsByDefinition = new WeakMap<EntityDefinition, Map<string, EventStoreExecutor>>();

export function registeredEntityExecutor(
  registry: Pick<Registry, "getEntity">,
  entityName: string,
): EventStoreExecutor | undefined {
  const entity = registry.getEntity(entityName);
  if (entity === undefined) return undefined;
  let byName = executorsByDefinition.get(entity);
  if (byName === undefined) {
    byName = new Map();
    executorsByDefinition.set(entity, byName);
  }
  const cached = byName.get(entityName);
  if (cached !== undefined) return cached;
  const { executor } = createEntityExecutor(entityName, entity);
  byName.set(entityName, executor);
  return executor;
}
