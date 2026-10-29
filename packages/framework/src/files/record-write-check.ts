import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { TenantDb } from "../db/tenant-db.ts";
import { hasAccess } from "../engine/access.ts";
import { userHasWriteRole } from "../engine/field-access.ts";
import { normalizeAccessEntry, userCanWriteFieldRow } from "../engine/ownership.ts";
import { toKebab } from "../engine/qualified-name.ts";
import { isRecordLocked } from "../engine/screen-helpers.ts";
import type { Registry, SessionUser, TenantId } from "../engine/types/index.ts";
import { resolveFileSubField } from "./file-field-slots.ts";
import type { RecordReadCheck } from "./record-read-check.ts";

export const RecordWriteDecisions = {
  writable: "writable",
  notFound: "not_found",
  forbidden: "forbidden",
  locked: "locked",
} as const;
export type RecordWriteDecision = (typeof RecordWriteDecisions)[keyof typeof RecordWriteDecisions];

export type RecordWriteCheck = (args: {
  readonly entityType: string;
  readonly entityId: string;
  readonly fieldName: string | undefined;
  /** Embedded file sub-field of `fieldName` the upload is meant for. */
  readonly subField?: string | undefined;
  readonly user: SessionUser;
}) => Promise<RecordWriteDecision>;

export function findImplicitEntityTable(registry: Registry, entityType: string) {
  for (const projection of registry.getAllProjections().values()) {
    if (projection.isImplicit === true && projection.source === entityType) {
      return projection.table;
    }
  }
  return undefined;
}

function isEntityUpdateWrite(qn: string, entityName: string): boolean {
  return qn.endsWith(`:write:${toKebab(entityName)}:update`);
}

// The named field's own write rules against the stored row. The upload names no embedded row,
// so a sub-field only gets the role gate; its row-level rules run when the record is saved.
function mayWriteNamedField(args: {
  readonly entity: EntityDefinition;
  readonly fieldName: string | undefined;
  readonly subField: string | undefined;
  readonly user: SessionUser;
  readonly row: Readonly<Record<string, unknown>>;
}): boolean {
  const { entity, fieldName, subField, user, row } = args;
  if (fieldName === undefined) return true;
  const fieldRules = normalizeAccessEntry(entity.fields[fieldName]?.access?.write);
  if (!userCanWriteFieldRow(user, fieldRules, row, row)) return false;
  const subFieldRules =
    subField === undefined
      ? undefined
      : normalizeAccessEntry(
          resolveFileSubField(entity.fields[fieldName], subField)?.access?.write,
        );
  return subFieldRules === undefined || userHasWriteRole(user, subFieldRules);
}

// "May this user attach a file to the record?" asks what saving the record would ask: the
// entity's update handler, the row-level and field-level write rules against the stored row,
// and the lock. Not-readable, foreign-tenant and missing records answer alike (not_found) so
// the upload never confirms what exists.
export function createRecordWriteCheck(args: {
  readonly registry: Registry;
  readonly canReadRecord: RecordReadCheck;
  readonly tenantDbFor: (tenantId: TenantId) => TenantDb;
}): RecordWriteCheck {
  const { registry, canReadRecord, tenantDbFor } = args;

  function findUpdateHandlerAccess(entityType: string) {
    for (const [qn, handler] of registry.getAllWriteHandlers()) {
      if (registry.getHandlerEntity(qn) === entityType && isEntityUpdateWrite(qn, entityType)) {
        return handler.access;
      }
    }
    return undefined;
  }

  return async ({ entityType, entityId, fieldName, subField, user }) => {
    if (!(await canReadRecord({ entityType, entityId, user }))) {
      return RecordWriteDecisions.notFound;
    }
    const entity = registry.getEntity(entityType);
    const table = findImplicitEntityTable(registry, entityType);
    if (!entity || !table) return RecordWriteDecisions.notFound;

    // The stored row, not the detail output: the detail query can hide ownership fields.
    const row = await tenantDbFor(user.tenantId).fetchOne<Record<string, unknown>>(table, {
      id: entityId,
      ...(entity.softDelete === true && { isDeleted: false }),
    });
    if (!row) return RecordWriteDecisions.notFound;

    if (!hasAccess(user, findUpdateHandlerAccess(entityType)))
      return RecordWriteDecisions.forbidden;
    if (!userCanWriteFieldRow(user, entity.access?.write, row, row)) {
      return RecordWriteDecisions.forbidden;
    }
    if (!mayWriteNamedField({ entity, fieldName, subField, user, row })) {
      return RecordWriteDecisions.forbidden;
    }
    if (isRecordLocked(entity.lockedWhen, row)) return RecordWriteDecisions.locked;
    return RecordWriteDecisions.writable;
  };
}

// The stored row, read through the given db so a transaction sees the lock state it commits against.
export async function isStoredRecordLocked(args: {
  readonly registry: Registry;
  readonly db: TenantDb;
  readonly entityType: string;
  readonly entityId: string;
}): Promise<boolean> {
  const { registry, db, entityType, entityId } = args;
  const entity = registry.getEntity(entityType);
  const table = findImplicitEntityTable(registry, entityType);
  if (!entity || !table || entity.lockedWhen === undefined) return false;
  const row = await db.fetchOne<Record<string, unknown>>(table, {
    id: entityId,
    ...(entity.softDelete === true && { isDeleted: false }),
  });
  return row !== undefined && isRecordLocked(entity.lockedWhen, row);
}
