import * as z from "zod";
import type { TenantDb } from "../db/tenant-db.js";
import { defineWriteHandler, SYSTEM_ROLE, SYSTEM_USER_ID } from "../engine/index.js";
import { type EntityDefinition, isFileField, type Registry } from "../engine/types/index.js";
import { ValidationError } from "../errors/index.js";
import { fileRefIdsOf } from "./bind-pending-file-refs.js";
import { getFileRefExecutor } from "./create-file-ref.js";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.js";
import { loadFileRefRows } from "./load-save-file-refs.js";
import { findImplicitEntityTable } from "./record-write-check.js";

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 200;

const payloadSchema = z.object({
  entityType: z.string().min(1),
  entityIds: z.array(z.uuid()).min(1).max(MAX_PAGE_SIZE).optional(),
  afterId: z.uuid().optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type BindReferencedFilesResult = {
  readonly bound: number;
  readonly skipped: number;
  readonly nextAfterId: string | null;
};

function invalidEntityType(): ValidationError {
  return new ValidationError({
    fields: [
      {
        path: "entityType",
        code: "invalid_value",
        i18nKey: "errors.validation.invalid_value",
      },
    ],
  });
}

// The entity must have an implicit table and declared file fields, and the files
// feature must be mounted; anything else is a caller error, not an empty page.
function resolveFileBearingEntity(
  registry: Registry,
  entityType: string,
): {
  readonly entity: EntityDefinition;
  readonly table: NonNullable<ReturnType<typeof findImplicitEntityTable>>;
  readonly fileFieldNames: readonly string[];
} {
  const entity = registry.getEntity(entityType);
  const table = findImplicitEntityTable(registry, entityType);
  if (entity === undefined || table === undefined) throw invalidEntityType();
  if (registry.getEntity(FILE_REF_ENTITY_NAME) === undefined) throw invalidEntityType();
  const fileFieldNames = Object.entries(entity.fields)
    .filter(([, fieldDef]) => isFileField(fieldDef))
    .map(([fieldName]) => fieldName);
  if (fileFieldNames.length === 0) throw invalidEntityType();
  return { entity, table, fileFieldNames };
}

type FileBearingEntity = ReturnType<typeof resolveFileBearingEntity>;

// Either the named records or one id-ordered page after afterId.
function loadRecordPage(
  db: TenantDb,
  { entity, table }: Pick<FileBearingEntity, "entity" | "table">,
  { entityIds, afterId, limit }: z.infer<typeof payloadSchema>,
): Promise<readonly (Record<string, unknown> & { id: string })[]> {
  return db.selectMany<Record<string, unknown> & { id: string }>(
    table,
    {
      ...(entity.softDelete === true && { isDeleted: false }),
      ...(entityIds !== undefined
        ? { id: entityIds }
        : afterId !== undefined && { id: { gt: afterId } }),
    },
    { orderBy: { col: "id", direction: "asc" }, ...(entityIds === undefined && { limit }) },
  );
}

type BindTarget = {
  readonly record: Record<string, unknown>;
  readonly entityType: string;
  readonly fieldName: string;
  readonly tenantId: string;
};

// Unbound and same tenant. The record's creator may bind their own unclaimed or pending upload.
// A system-generated file carries no owner of its own, so it binds only where it is already
// pending for exactly this entity field — an unclaimed one could otherwise be pulled into any
// record that merely names its id.
function isBindableToRecord(fileRef: Record<string, unknown>, target: BindTarget): boolean {
  const uploader = fileRef["insertedById"];
  if (
    typeof uploader !== "string" ||
    fileRef["tenantId"] !== target.tenantId ||
    fileRef["entityId"] !== null
  ) {
    return false;
  }
  const isPendingForTarget =
    fileRef["entityType"] === target.entityType && fileRef["fieldName"] === target.fieldName;
  if (uploader === target.record["insertedById"]) {
    return fileRef["entityType"] === null || isPendingForTarget;
  }
  return uploader === SYSTEM_USER_ID && isPendingForTarget;
}

// The binding follows only the record's declared file fields; the caller names
// no file ids. The record's creator must have uploaded the file themselves (or the
// system generated it for exactly this field), otherwise a foreign reference would pull
// someone else's private upload into the referencing user's record and make it readable there.
export const bindReferencedFilesWrite = defineWriteHandler({
  name: "bindReferencedFiles",
  schema: payloadSchema,
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  // Maintenance backfill run by ops or system jobs, not a task an assistant performs.
  agent: { expose: false },
  description:
    "Binds the files a record references through its declared file fields to that record, so readers of the record see them through record access. Covers files uploaded before pending-upload binding existed (entityId null) and records created without a save lifecycle (custom handlers, system jobs). Binds only files uploaded by the record's creator or generated by the system for exactly this field; skips files already bound elsewhere, uploaded by someone else, of another tenant or missing; never rebinds.",
  handler: async (event, ctx) => {
    const { entityType, entityIds, limit } = event.payload;
    const { fileFieldNames, ...source } = resolveFileBearingEntity(ctx.registry, entityType);
    const records = await loadRecordPage(ctx.db, source, event.payload);

    const referencedIds = records.flatMap((record) =>
      fileFieldNames.flatMap((fieldName) => fileRefIdsOf(record[fieldName])),
    );
    const fileRefRows = await loadFileRefRows(ctx.db, referencedIds, event.user.tenantId);

    const executor = getFileRefExecutor();
    let bound = 0;
    let skipped = 0;
    for (const record of records) {
      for (const fieldName of fileFieldNames) {
        for (const fileRefId of fileRefIdsOf(record[fieldName])) {
          const row = fileRefRows.get(fileRefId);
          if (
            row === undefined ||
            !isBindableToRecord(row, {
              record,
              entityType,
              fieldName,
              tenantId: event.user.tenantId,
            })
          ) {
            skipped += 1;
            continue;
          }
          const version = typeof row["version"] === "number" ? row["version"] : undefined;
          const result = await executor.update(
            { id: fileRefId, version, changes: { entityType, entityId: record.id, fieldName } },
            event.user,
            ctx.db,
          );
          if (!result.isSuccess) return result;
          bound += 1;
        }
      }
    }

    const lastRecord = records[records.length - 1];
    const pageIsFull = entityIds === undefined && records.length === limit;
    const nextAfterId = pageIsFull ? (lastRecord?.id ?? null) : null;
    return { isSuccess: true, data: { bound, skipped, nextAfterId } };
  },
});
