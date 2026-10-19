import type { TenantDb } from "../db/tenant-db.ts";
import { isAnonymousSessionUser } from "../engine/system-user.ts";
import {
  isFileField,
  isUuid,
  type Registry,
  type SaveContext,
  type SessionUser,
} from "../engine/types/index.ts";
import { reraiseAsKumikoError, type WriteErrorInfo } from "../errors/index.ts";
import { getFileRefExecutor } from "./create-file-ref.ts";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.ts";
import { type FileRefRows, loadFileRefRows } from "./load-save-file-refs.ts";

export function fileRefIdsOf(value: unknown): readonly string[] {
  if (typeof value === "string") return isUuid(value) ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && isUuid(item));
}

function isPendingUploadFor(
  row: Readonly<Record<string, unknown>>,
  entityName: string,
  fieldName: string,
  user: SessionUser,
): boolean {
  return (
    row["entityId"] === null &&
    row["entityType"] === entityName &&
    row["fieldName"] === fieldName &&
    row["insertedById"] === user.id
  );
}

type FileRefRow = Readonly<Record<string, unknown>>;

type BindOutcome =
  | { readonly kind: "bound" }
  | { readonly kind: "not-pending" }
  | { readonly kind: "failed"; readonly error: WriteErrorInfo };

function streamVersionOf(row: FileRefRow): number | undefined {
  return typeof row["version"] === "number" ? row["version"] : undefined;
}

async function bindPendingRow(args: {
  readonly row: FileRefRow;
  readonly fileRefId: string;
  readonly entityName: string;
  readonly fieldName: string;
  readonly entityId: string;
  readonly user: SessionUser;
  readonly db: TenantDb;
}): Promise<BindOutcome> {
  const { row, fileRefId, entityName, fieldName, entityId, user, db } = args;
  if (!isPendingUploadFor(row, entityName, fieldName, user)) return { kind: "not-pending" };
  const bound = await getFileRefExecutor().update(
    { id: fileRefId, version: streamVersionOf(row), changes: { entityId } },
    user,
    db,
  );
  return bound.isSuccess ? { kind: "bound" } : { kind: "failed", error: bound.error };
}

// A form (or a server handler via createFileRefFromBytes) uploads before the
// record references the file, so its fileRefs carry entityType + fieldName but
// no entityId. Binding them in the save's own transaction makes record-bound
// variants (qr overlay) and record-read file access work for them. Only the
// caller's own pending uploads for exactly this entity field are bound: naming
// someone else's upload id in a save payload must not pull that file into a
// record the caller controls.
export async function bindPendingFileRefs(args: {
  readonly registry: Registry;
  readonly result: SaveContext;
  readonly user: SessionUser;
  readonly db: TenantDb;
  readonly fileRefRows: FileRefRows;
}): Promise<void> {
  const { registry, result, user, db, fileRefRows } = args;
  // skip: saves of unnamed aggregates declare no file fields
  if (result.entityName === undefined) return;
  const entityName = result.entityName;
  const entity = registry.getEntity(entityName);
  // skip: saves of unregistered aggregates (custom executors) declare no file fields
  if (entity === undefined) return;
  // skip: without the files feature the file_refs table is not part of the schema
  if (registry.getEntity(FILE_REF_ENTITY_NAME) === undefined) return;

  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!isFileField(fieldDef)) continue;
    // changes, not data: an update's row carries every stored file id, including
    // ones bound earlier; only the ids this save names can be pending uploads.
    for (const fileRefId of fileRefIdsOf(result.changes[fieldName])) {
      const row = fileRefRows.get(fileRefId);
      if (row === undefined) continue;
      const outcome = await bindPendingRow({
        row,
        fileRefId,
        entityName,
        fieldName,
        entityId: String(result.id),
        user,
        db,
      });
      if (outcome.kind === "failed") throw reraiseAsKumikoError(outcome.error);
    }
  }
}

export type PendingFileRef = {
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly size: number;
  readonly version: number;
};

type PendingFileRefLookup = {
  readonly fileRefId: string;
  readonly entityName: string;
  readonly fieldName: string;
  readonly user: SessionUser;
  readonly db: TenantDb;
};

async function loadPendingRow(lookup: PendingFileRefLookup): Promise<FileRefRow | undefined> {
  const { fileRefId, entityName, fieldName, user, db } = lookup;
  // Every anonymous visitor shares one user id, so insertedById cannot tell their uploads apart.
  if (isAnonymousSessionUser(user)) return undefined;
  if (!isUuid(fileRefId)) return undefined;
  const row = (await loadFileRefRows(db, [fileRefId], user.tenantId)).get(fileRefId);
  return row !== undefined && isPendingUploadFor(row, entityName, fieldName, user)
    ? row
    : undefined;
}

// fileName is left out on purpose: it is personal data and may be encrypted; read it through
// the fileRef executor's detail when it is needed.
export async function loadPendingFileRef(
  lookup: PendingFileRefLookup,
): Promise<PendingFileRef | undefined> {
  const row = await loadPendingRow(lookup);
  if (row === undefined) return undefined;
  const { storageKey, mimeType, size } = row;
  const version = streamVersionOf(row);
  if (
    typeof storageKey !== "string" ||
    typeof mimeType !== "string" ||
    typeof size !== "number" ||
    version === undefined
  ) {
    return undefined;
  }
  return { id: lookup.fileRefId, storageKey, mimeType, size, version };
}

export type BindPendingFileRefOutcome = "bound" | "not-pending" | "version-conflict";

const CONCURRENT_BIND_ERROR_CODES: readonly string[] = ["version_conflict", "unique_violation"];

/**
 * Binds one of the caller's own pending uploads to a record from a custom handler, with the
 * same ownership predicate as the save pipeline. Anonymous callers never own an upload.
 *
 * The helper checks the upload, not the target: the caller must already be authorized to write
 * `entityId` itself (for example a record the handler just wrote); `canWriteRecord` is not checked.
 *
 * A parallel bind of the same fileRef loses with "version-conflict" (or "not-pending" once the
 * winner has committed); anything else throws.
 */
export async function bindPendingFileRef(
  args: PendingFileRefLookup & { readonly entityId: string },
): Promise<BindPendingFileRefOutcome> {
  const row = await loadPendingRow(args);
  // Without a stream version the update would run unversioned and could overwrite a concurrent bind.
  if (row === undefined || streamVersionOf(row) === undefined) return "not-pending";
  const outcome = await bindPendingRow({ ...args, row });
  switch (outcome.kind) {
    case "bound":
      return "bound";
    case "not-pending":
      return "not-pending";
    case "failed":
      if (CONCURRENT_BIND_ERROR_CODES.includes(outcome.error.code)) return "version-conflict";
      throw reraiseAsKumikoError(outcome.error);
  }
}
