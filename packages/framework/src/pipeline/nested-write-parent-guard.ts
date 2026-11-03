import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import type { DbTx } from "../db/connection.ts";
import { createTenantDb, hasTenantColumn } from "../db/tenant-db.ts";
import { checkWriteFieldOwnership } from "../engine/field-access.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { AccessDeniedError, FrameworkReasons, writeFailure } from "../errors/index.ts";
import { getTable, resolveDbSource } from "./dispatch-context-helpers.ts";
import type { DispatchContext } from "./dispatch-shared.ts";

function isForeignTenantParentRow(
  parentRow: Readonly<Record<string, unknown>>,
  user: SessionUser,
): boolean {
  const rowTenantId = parentRow["tenantId"];
  return typeof rowTenantId === "string" && rowTenantId !== user.tenantId;
}

// A custom create handler may return a row without a string tenantId; the row's
// tenant is then unknown from the payload, so re-read it through the caller's tenant
// filter. Fail-closed: anything that cannot be verified counts as not visible.
// Tenant reads also return SYSTEM reference rows, so the row's own tenantId must match
// (same rule as the string path) unless the entity has no tenant column.
async function isParentRowHiddenFromCaller(
  ctx: DispatchContext,
  parentEntityName: string | undefined,
  parentId: string,
  user: SessionUser,
  tx: DbTx | undefined,
): Promise<boolean> {
  if (parentEntityName === undefined) return true;
  const table = getTable(ctx, parentEntityName);
  const source = resolveDbSource(ctx, tx);
  if (!table || !source) return true;
  const callerDb = createTenantDb({ db: source, tenantId: user.tenantId, mode: "tenant" });
  const visibleRow = await callerDb.fetchOne(table, { id: parentId });
  if (visibleRow === undefined) return true;
  return hasTenantColumn(table) && visibleRow["tenantId"] !== user.tenantId;
}

// A custom create handler may return a partial row. The ownership check only
// inspects the keys it is given, so a row missing the ownership-bound field
// would be denied (rule evaluated against undefined) or skipped entirely.
// Complete it from the stored row, read through the caller's tenant filter.
async function completeParentRow(
  ctx: DispatchContext,
  parentEntityName: string,
  parentEntity: EntityDefinition,
  parentRow: Record<string, unknown>,
  user: SessionUser,
  tx: DbTx | undefined,
): Promise<Record<string, unknown>> {
  if (Object.keys(parentEntity.fields).every((fieldName) => fieldName in parentRow)) {
    return parentRow;
  }
  const table = getTable(ctx, parentEntityName);
  const source = resolveDbSource(ctx, tx);
  if (!table || !source || typeof parentRow["id"] !== "string") return parentRow;
  const stored = await createTenantDb({
    db: source,
    tenantId: user.tenantId,
    mode: "tenant",
  }).fetchOne(table, {
    id: parentRow["id"],
  });
  return stored ? { ...stored, ...parentRow } : parentRow;
}

// A custom create handler may return an existing foreign row; verify it before attaching children.
export async function rejectUnverifiedParent(
  ctx: DispatchContext,
  type: string,
  parentRow: Record<string, unknown>,
  parentId: string,
  user: SessionUser,
  tx: DbTx | undefined,
): Promise<WriteResult | undefined> {
  const { registry } = ctx;
  const parentEntityName = registry.getHandlerEntity(type);
  const isCallerScoped = !registry.isHandlerSystemScoped(type);
  const isParentForeign =
    isCallerScoped &&
    (typeof parentRow["tenantId"] === "string"
      ? isForeignTenantParentRow(parentRow, user)
      : await isParentRowHiddenFromCaller(ctx, parentEntityName, parentId, user, tx));
  if (isParentForeign) {
    return writeFailure(
      new AccessDeniedError({
        message: `nested-write: parent row belongs to another tenant — refusing to attach children to "${type}"`,
        details: { reason: FrameworkReasons.fieldAccessDenied, handler: type },
      }),
    );
  }
  if (!parentEntityName) return undefined;
  const parentEntity = registry.getEntity(parentEntityName);
  if (!parentEntity) return undefined;
  const ownershipRow = await completeParentRow(
    ctx,
    parentEntityName,
    parentEntity,
    parentRow,
    user,
    tx,
  );
  const deniedField = checkWriteFieldOwnership(
    parentEntity,
    ownershipRow,
    user,
    undefined,
    ownershipRow,
    false,
  );
  if (!deniedField) return undefined;
  return writeFailure(
    new AccessDeniedError({
      message: `nested-write: parent row ownership check failed on field "${deniedField}" of "${type}" — refusing to attach children to a parent row the caller does not own`,
      i18nKey: "errors.access.fieldDenied",
      details: {
        reason: FrameworkReasons.fieldAccessDenied,
        field: deniedField,
        handler: type,
      },
    }),
  );
}
