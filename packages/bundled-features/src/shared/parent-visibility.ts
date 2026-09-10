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

// Checks whether a client-supplied (entityType, entityId) host reference is one
// the caller can see via that entity's own read path — tenant scope plus its
// `access.read` ownership. Shared by every handler that attaches something to a
// host entity the client names (add-note, assign-tag, remove-tag, set-folder,
// clear-folder); those handlers deny with NotFoundError so the response never
// doubles as an existence oracle.
export async function parentRowIsVisible(
  registry: Registry,
  entityType: string,
  entityId: string,
  user: SessionUser,
  db: TenantDb,
): Promise<boolean> {
  // Default-deny: an entityType that names no registered entity has no read
  // path to check visibility against, so it can never be a valid parent.
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
