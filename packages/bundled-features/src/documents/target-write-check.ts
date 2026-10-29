import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  hasAccess,
  type Registry,
  type SessionUser,
  toKebab,
  userCanWriteFieldRow,
} from "@cosmicdrift/kumiko-framework/engine";
import { parentRowIsVisible } from "../shared/index.ts";

function updateHandlerAccessOf(registry: Registry, entityType: string) {
  const suffix = `:write:${toKebab(entityType)}:update`;
  for (const [qn, handler] of registry.getAllWriteHandlers()) {
    if (qn.endsWith(suffix) && registry.getHandlerEntity(qn) === entityType) return handler.access;
  }
  return undefined;
}

// Linking a document changes what readers of the target see, so it needs what saving the target
// needs: read visibility, a write gate and its row-level write rule. The gate is the entity's
// update handler; an entity saved only through custom handlers has none, so its declared write
// roles stand in, and without either the target stays unlinkable. A target that is not visible
// answers like a missing one.
export async function canWriteLinkTarget(
  registry: Registry,
  entityType: string,
  entityId: string,
  user: SessionUser,
  db: TenantDb,
): Promise<boolean> {
  if (!(await parentRowIsVisible(registry, entityType, entityId, user, db))) return false;
  const entity = registry.getEntity(entityType);
  if (entity === undefined) return false;
  const updateAccess = updateHandlerAccessOf(registry, entityType);
  if (updateAccess !== undefined) {
    if (!hasAccess(user, updateAccess)) return false;
  } else if (!hasAccess(user, { roles: Object.keys(entity.access?.write ?? {}) })) {
    return false;
  }
  const row = await createEntityExecutor(entityType, entity).executor.detail(
    { id: entityId },
    user,
    db,
  );
  return row !== null && userCanWriteFieldRow(user, entity.access?.write, row, row);
}
