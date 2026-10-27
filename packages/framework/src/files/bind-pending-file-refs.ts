import type { SaveContext } from "@cosmicdrift/kumiko-types/hooks";
import { isUuid } from "@cosmicdrift/kumiko-types/identifiers";
import type { TenantDb } from "../db/tenant-db.ts";
import { isFileField } from "../engine/field-helpers.ts";
import { isAnonymousSessionUser } from "../engine/system-user.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";

import {
  FrameworkReasons,
  InternalError,
  reraiseAsKumikoError,
  UnprocessableError,
  type WriteErrorInfo,
} from "../errors/index.ts";
import { getFileRefExecutor } from "./create-file-ref.ts";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.ts";
import { type FileRefRows, loadFileRefRows } from "./load-save-file-refs.ts";
import { validateFile } from "./types.ts";
import { resolveAttachedField } from "./upload-field-resolution.ts";

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
  // Every anonymous visitor shares one user id, so insertedById cannot tell their uploads apart.
  if (isAnonymousSessionUser(user)) return false;
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
  readonly bindTo?: PendingFileRefBindTarget | undefined;
  readonly user: SessionUser;
  readonly db: TenantDb;
}): Promise<BindOutcome> {
  const { row, fileRefId, entityName, fieldName, entityId, bindTo, user, db } = args;
  if (!isPendingUploadFor(row, entityName, fieldName, user)) return { kind: "not-pending" };
  const bound = await getFileRefExecutor().update(
    {
      id: fileRefId,
      version: streamVersionOf(row),
      changes:
        bindTo === undefined
          ? { entityId }
          : { entityId, entityType: bindTo.entityName, fieldName: bindTo.fieldName },
    },
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

export type PendingFileRefBindTarget = {
  readonly entityName: string;
  readonly fieldName: string;
};

// The pending upload was checked against the form field it came in through; a different target
// field may be stricter. Metadata only (bytes are not re-read): the extension comes from the
// storage key, whose suffix is the sniffed type, because fileName may be encrypted personal data.
export function assertRowFitsBindTarget(
  registry: Registry | undefined,
  bindTo: PendingFileRefBindTarget,
  row: FileRefRow,
): void {
  const target = resolveAttachedField(registry, bindTo.entityName, bindTo.fieldName);
  if (target.kind !== "resolved") {
    throw new InternalError({
      message: `bindPendingFileRef: bindTo ${bindTo.entityName}.${bindTo.fieldName} is not a registered file field (pass the handler's ctx.registry)`,
    });
  }
  const { storageKey, mimeType, size } = row;
  if (typeof storageKey !== "string" || typeof mimeType !== "string" || typeof size !== "number") {
    // A row without these can only come from corruption; letting it through would skip the check.
    throw new InternalError({
      message: `bindPendingFileRef: pending file_ref ${String(row["id"])} lacks storageKey, mimeType or size`,
    });
  }
  const error = validateFile(
    { fileName: storageKey, mimeType, size },
    { maxSize: target.fieldDef.maxSize, accept: target.fieldDef.accept },
  );
  if (error !== null) {
    throw new UnprocessableError(FrameworkReasons.fileViolatesBindTarget, {
      i18nKey: "errors.file.violatesBindTarget",
      details: { error },
    });
  }
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
 * `bindTo` moves the upload onto an entity file field of its own: a form upload is pending under
 * the actionForm screen (entityName = the screen QN), and the handler decides which entity field
 * keeps it. The row is re-tagged to `bindTo` and must fit that field's `accept`/`maxSize`
 * (UnprocessableError otherwise); the field must be registered, which needs `registry`
 * (the handler's `ctx.registry`), else InternalError.
 *
 * A parallel bind of the same fileRef loses with "version-conflict" (or "not-pending" once the
 * winner has committed); anything else throws.
 */
export async function bindPendingFileRef(
  args: PendingFileRefLookup & {
    readonly entityId: string;
    readonly bindTo?: PendingFileRefBindTarget;
    readonly registry?: Registry;
  },
): Promise<BindPendingFileRefOutcome> {
  const row = await loadPendingRow(args);
  // Without a stream version the update would run unversioned and could overwrite a concurrent bind.
  if (row === undefined || streamVersionOf(row) === undefined) return "not-pending";
  if (args.bindTo !== undefined) assertRowFitsBindTarget(args.registry, args.bindTo, row);
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
