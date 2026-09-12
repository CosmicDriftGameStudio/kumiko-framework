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

  // Mirrors the SQL gate, which drops join-row candidates for the same reason:
  // resolving a host that is itself a join row would need recursive gating.
  if (entity.parentRef !== undefined) return false;

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

// Write-path half of the parentRef gate (fw#2766). Resolves the join entity's
// own `parentRef` declaration from the registry — the same object the read
// path's SQL gate reads — so the field names and the allowedTypes allowlist
// exist in exactly one place instead of once per path.
export async function joinRowParentIsVisible(
  registry: Registry,
  joinEntityName: string,
  payload: Readonly<Record<string, unknown>>,
  user: SessionUser,
  db: TenantDb,
): Promise<boolean> {
  const parentRef = registry.getEntity(joinEntityName)?.parentRef;
  // A mount whose join entity lost its declaration can't derive a gate —
  // deny rather than silently fall back to the pre-#2766 open behaviour.
  if (parentRef === undefined) return false;

  const entityType = payload[parentRef.entityTypeField];
  const entityId = payload[parentRef.entityIdField];
  if (typeof entityType !== "string" || typeof entityId !== "string") return false;
  if (parentRef.allowedTypes !== undefined && !parentRef.allowedTypes.includes(entityType)) {
    return false;
  }

  return parentRowIsVisible(registry, entityType, entityId, user, db);
}
