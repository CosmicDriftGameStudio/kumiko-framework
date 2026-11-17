import {
  type AccessRule,
  defineQueryHandler,
  type HandlerContext,
  listAllPages,
  normalizeAccessEntry,
  registeredEntityExecutor,
  type SessionUser,
  userCanApproveField,
  userCanReadFieldRow,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ListFilterOption } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type * as z from "zod";
import { visibleParentRowIds } from "../../shared/index.ts";
import { FieldChangeStatus } from "../constants.ts";
import type { fieldChangeRequestExecutor } from "../executor.ts";
import { pendingFieldChangesQuerySchema } from "../schemas.ts";
import { openRequestedValue } from "../stored-value.ts";
import { requesterIdOf } from "./decide-change.ts";

type PendingRequestRow = Record<string, unknown>;
type PendingChangesContext = Pick<HandlerContext, "db" | "registry">;

function pendingRequestFilters(
  input: z.infer<typeof pendingFieldChangesQuerySchema>,
): ListFilterOption[] {
  const filters: ListFilterOption[] = [
    { field: "status", op: "eq", value: FieldChangeStatus.Pending },
  ];
  if (input.entityType !== undefined) {
    filters.push({ field: "entityType", op: "eq", value: input.entityType });
  }
  if (input.entityId !== undefined) {
    filters.push({ field: "entityId", op: "eq", value: input.entityId });
  }
  return filters;
}

async function visibleHostIdsByType(
  pending: readonly PendingRequestRow[],
  ctx: PendingChangesContext,
  user: SessionUser,
): Promise<Map<string, ReadonlySet<string>>> {
  const idsByType = new Map<string, string[]>();
  for (const row of pending) {
    const type = String(row["entityType"]);
    const ids = idsByType.get(type) ?? [];
    ids.push(String(row["entityId"]));
    idsByType.set(type, ids);
  }
  const visibleByType = new Map<string, ReadonlySet<string>>();
  for (const [type, ids] of idsByType) {
    visibleByType.set(type, await visibleParentRowIds(ctx.registry, type, ids, user, ctx.db));
  }
  return visibleByType;
}

// An approver who may not read the field does not see the requested value.
async function approverMayReadRequestedValue(
  ctx: PendingChangesContext,
  user: SessionUser,
  entityType: string,
  entityId: string,
  readMap: NonNullable<ReturnType<typeof normalizeAccessEntry>>,
): Promise<boolean> {
  const hostRow = await registeredEntityExecutor(ctx.registry, entityType)?.detail(
    { id: entityId },
    user,
    ctx.db,
  );
  return !!hostRow && userCanReadFieldRow(user, readMap, hostRow);
}

async function toPendingChangeSummary(
  row: PendingRequestRow,
  visibleByType: ReadonlyMap<string, ReadonlySet<string>>,
  ctx: PendingChangesContext,
  user: SessionUser,
) {
  const entityType = String(row["entityType"]);
  const entityId = String(row["entityId"]);
  const fieldName = String(row["fieldName"]);
  if (visibleByType.get(entityType)?.has(entityId) !== true) return undefined;
  const field = ctx.registry.getEntity(entityType)?.fields[fieldName];
  if (field === undefined) return undefined;
  const filedByCaller = requesterIdOf(row) === user.id;
  const mayApprove = userCanApproveField(user, field);
  if (!mayApprove && !filedByCaller) return undefined;
  const readMap = normalizeAccessEntry(field.access?.read);
  if (
    !filedByCaller &&
    readMap !== undefined &&
    !(await approverMayReadRequestedValue(ctx, user, entityType, entityId, readMap))
  ) {
    return undefined;
  }
  const opened = await openRequestedValue(row["requestedValue"], fieldName);
  if (!opened.ok) return undefined;
  return {
    id: String(row["id"]),
    version: Number(row["version"]),
    entityType,
    entityId,
    fieldName,
    value: opened.value,
    requestedBy: requesterIdOf(row),
    requestedAt: row["modifiedAt"] ?? row["insertedAt"],
    canApprove: mayApprove && !filedByCaller,
  };
}

export function createPendingChangesQuery(
  access: AccessRule,
  requestExecutor: typeof fieldChangeRequestExecutor,
) {
  return defineQueryHandler({
    name: "pending-changes",
    schema: pendingFieldChangesQuerySchema,
    access,
    description:
      "Lists open field change requests the caller may decide or has filed, with the requested value.",
    unfilteredResult: {
      reason:
        "rows are request summaries filtered per host record and approver role by the handler",
    },
    handler: async (query, ctx) => {
      const user = query.user;
      const filters = pendingRequestFilters(query.payload);
      const pending = await listAllPages((page) =>
        requestExecutor.list({ ...page, filters }, user, ctx.db),
      );
      const visibleByType = await visibleHostIdsByType(pending, ctx, user);

      const rows = [];
      for (const row of pending) {
        const summary = await toPendingChangeSummary(row, visibleByType, ctx, user);
        if (summary !== undefined) rows.push(summary);
      }
      return { rows };
    },
  });
}
