import type { EventStoreExecutor, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  type EntityDefinition,
  isUuid,
  type Registry,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";

// Keyed by definition identity, not by entity name — two test stacks can
// register different EntityDefinitions under the same entity name.
const executorsByEntity = new WeakMap<EntityDefinition, EventStoreExecutor>();

function idShapeMatchesEntity(entity: EntityDefinition, entityId: string): boolean {
  return entity.idType === "serial" ? /^\d+$/.test(entityId) : isUuid(entityId);
}

// Checks whether a note's proposed (entityType, entityId) parent is one the
// caller can see via the parent entity's own read path — tenant scope plus
// its `access.read` ownership. Used to gate add-note when a `parents`
// allowlist is configured (see feature.ts).
export async function parentRowIsVisible(
  registry: Registry,
  entityType: string,
  entityId: string,
  user: SessionUser,
  db: TenantDb,
): Promise<boolean> {
  const entity = registry.getEntity(entityType);
  if (!entity) return false;

  // A malformed id would abort the write transaction on a Postgres cast
  // error (22P02) instead of cleanly denying — reject it before it reaches
  // the executor.
  if (!idShapeMatchesEntity(entity, entityId)) return false;

  let executor = executorsByEntity.get(entity);
  if (!executor) {
    executor = createEntityExecutor(entityType, entity).executor;
    executorsByEntity.set(entity, executor);
  }

  return (await executor.detail({ id: entityId }, user, db)) !== null;
}
