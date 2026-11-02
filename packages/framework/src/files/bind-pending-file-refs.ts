import type { AnyFileFieldDef } from "@cosmicdrift/kumiko-types/fields";
import type { SaveContext } from "@cosmicdrift/kumiko-types/hooks";
import { isUuid, parseFileHandle } from "@cosmicdrift/kumiko-types/identifiers";
import type { TenantDb } from "../db/tenant-db.ts";
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
import { fileClaimMatches } from "./file-claim.ts";
import { fileRefIdsInField, holdsFileRefs } from "./file-field-slots.ts";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.ts";
import { invalidFileRefError } from "./invalid-file-ref-error.ts";
import { type FileRefRows, loadFileRefRows } from "./load-save-file-refs.ts";
import { validateFile } from "./types.ts";
import { resolveAttachedField } from "./upload-field-resolution.ts";

export { fileRefIdsOf } from "./file-field-slots.ts";

function isPendingUploadFor(
  row: Readonly<Record<string, unknown>>,
  entityName: string,
  fieldName: string,
): boolean {
  return (
    row["entityId"] === null && row["entityType"] === entityName && row["fieldName"] === fieldName
  );
}

// Every anonymous visitor shares one user id, so insertedById cannot tell their uploads apart:
// an anonymous upload is owned by whoever holds its claim, never by user id.
export function isOwnUpload(row: Readonly<Record<string, unknown>>, user: SessionUser): boolean {
  return !isAnonymousSessionUser(user) && row["insertedById"] === user.id;
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
  /** The writer presented the claim of this upload's handle. */
  readonly claimed: boolean;
}): Promise<BindOutcome> {
  const { row, fileRefId, entityName, fieldName, entityId, bindTo, user, db, claimed } = args;
  if (!isPendingUploadFor(row, entityName, fieldName)) return { kind: "not-pending" };
  if (!claimed && !isOwnUpload(row, user)) return { kind: "not-pending" };
  const bound = await getFileRefExecutor().update(
    {
      id: fileRefId,
      version: streamVersionOf(row),
      changes: {
        entityId,
        ...(bindTo !== undefined && { entityType: bindTo.entityName, fieldName: bindTo.fieldName }),
        ...(claimed && { claimHash: null }),
      },
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
  const claimedFileRefIds = new Set(result.claimedFileRefIds);
  const entity = registry.getEntity(entityName);
  // skip: saves of unregistered aggregates (custom executors) declare no file fields
  if (entity === undefined) return;
  // skip: without the files feature the file_refs table is not part of the schema
  if (registry.getEntity(FILE_REF_ENTITY_NAME) === undefined) return;

  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!holdsFileRefs(fieldDef)) continue;
    // changes, not data: an update's row carries every stored file id, including
    // ones bound earlier; only the ids this save names can be pending uploads.
    for (const fileRefId of fileRefIdsInField(fieldDef, result.changes[fieldName])) {
      const row = fileRefRows.get(fileRefId);
      if (row === undefined) continue;
      const claimed = claimedFileRefIds.has(fileRefId);
      const outcome = await bindPendingRow({
        row,
        fileRefId,
        entityName,
        fieldName,
        entityId: String(result.id),
        user,
        db,
        claimed,
      });
      // A proven claim must end in a bind; staying silent would store the id of a file that
      // remains pending with a live claim.
      if (claimed && outcome.kind === "not-pending") throw invalidFileRefError(fieldName);
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

type LoadedPendingRow = {
  readonly id: string;
  readonly row: FileRefRow;
  readonly claimed: boolean;
};

// `fileRefId` is a bare id (the caller must own the upload) or a handle (the claim must match).
async function loadPendingRow(lookup: PendingFileRefLookup): Promise<LoadedPendingRow | undefined> {
  const { fileRefId, entityName, fieldName, user, db } = lookup;
  const handle = parseFileHandle(fileRefId);
  const id = handle?.id ?? fileRefId;
  if (!isUuid(id)) return undefined;
  const row = (await loadFileRefRows(db, [id], user.tenantId)).get(id);
  if (row === undefined || !isPendingUploadFor(row, entityName, fieldName)) return undefined;
  if (handle !== null) {
    return fileClaimMatches(row["claimHash"], handle.claim)
      ? { id, row, claimed: true }
      : undefined;
  }
  return isOwnUpload(row, user) ? { id, row, claimed: false } : undefined;
}

// fileName is left out on purpose: it is personal data and may be encrypted; read it through
// the fileRef executor's detail when it is needed.
export async function loadPendingFileRef(
  lookup: PendingFileRefLookup,
): Promise<PendingFileRef | undefined> {
  const pending = await loadPendingRow(lookup);
  if (pending === undefined) return undefined;
  const { row } = pending;
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
  return { id: pending.id, storageKey, mimeType, size, version };
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
  assertRowFitsFileField(row, target.fieldDef);
}

// Same metadata check for any file slot a stored row lands in (a bind target, or an embedded
// file sub-field a save names).
export function assertRowFitsFileField(row: FileRefRow, fieldDef: AnyFileFieldDef): void {
  const { storageKey, mimeType, size } = row;
  if (typeof storageKey !== "string" || typeof mimeType !== "string" || typeof size !== "number") {
    // A row without these can only come from corruption; letting it through would skip the check.
    throw new InternalError({
      message: `file_ref ${String(row["id"])} lacks storageKey, mimeType or size`,
    });
  }
  const error = validateFile(
    { fileName: storageKey, mimeType, size },
    { maxSize: fieldDef.maxSize, accept: fieldDef.accept },
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
 * same ownership predicate as the save pipeline. Anonymous callers never own an upload by user
 * id: they pass the handle from the upload response as `fileRefId`.
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
  const pending = await loadPendingRow(args);
  // Without a stream version the update would run unversioned and could overwrite a concurrent bind.
  if (pending === undefined || streamVersionOf(pending.row) === undefined) return "not-pending";
  if (args.bindTo !== undefined) assertRowFitsBindTarget(args.registry, args.bindTo, pending.row);
  const outcome = await bindPendingRow({
    ...args,
    fileRefId: pending.id,
    row: pending.row,
    claimed: pending.claimed,
  });
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
