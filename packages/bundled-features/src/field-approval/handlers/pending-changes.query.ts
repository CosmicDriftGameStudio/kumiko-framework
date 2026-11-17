import {
  type AccessRule,
  defineQueryHandler,
  listAllPages,
  userCanApproveField,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ListFilterOption } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import { visibleParentRowIds } from "../../shared/index.ts";
import { FieldChangeStatus } from "../constants.ts";
import type { fieldChangeRequestExecutor } from "../executor.ts";
import { pendingFieldChangesQuerySchema } from "../schemas.ts";
import { openRequestedValue } from "../stored-value.ts";

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
      const input = query.payload;
      const user = query.user;
      const filters: ListFilterOption[] = [
        { field: "status", op: "eq", value: FieldChangeStatus.Pending },
      ];
      if (input.entityType !== undefined) {
        filters.push({ field: "entityType", op: "eq", value: input.entityType });
      }
      if (input.entityId !== undefined) {
        filters.push({ field: "entityId", op: "eq", value: input.entityId });
      }
      const pending = await listAllPages((page) =>
        requestExecutor.list({ ...page, filters }, user, ctx.db),
      );

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

      const rows = [];
      for (const row of pending) {
        const entityType = String(row["entityType"]);
        const entityId = String(row["entityId"]);
        const fieldName = String(row["fieldName"]);
        if (visibleByType.get(entityType)?.has(entityId) !== true) continue;
        const field = ctx.registry.getEntity(entityType)?.fields[fieldName];
        if (field === undefined) continue;
        const filedByCaller = row["modifiedById"] === user.id;
        const mayApprove = userCanApproveField(user, field);
        if (!mayApprove && !filedByCaller) continue;
        const opened = await openRequestedValue(row["requestedValue"], fieldName);
        if (!opened.ok) continue;
        rows.push({
          id: String(row["id"]),
          version: Number(row["version"]),
          entityType,
          entityId,
          fieldName,
          value: opened.value,
          requestedBy: row["modifiedById"],
          requestedAt: row["modifiedAt"],
          canApprove: mayApprove && !filedByCaller,
        });
      }
      return { rows };
    },
  });
}
