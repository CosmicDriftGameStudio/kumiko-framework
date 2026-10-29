import { isUuid } from "@cosmicdrift/kumiko-types/identifiers";
import { isFrameworkSystemUser } from "../db/lock-guard.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import { RecordLockedError } from "../errors/classes.ts";
import { AccessDeniedError, InternalError, reraiseAsKumikoError } from "../errors/index.ts";
import { assertRowFitsBindTarget } from "./bind-pending-file-refs.ts";
import { type CanReadFileRefContext, canCallerReadFileRef } from "./can-caller-read-file-ref.ts";
import { getFileRefExecutor } from "./create-file-ref.ts";
import type { FileRef } from "./file-routes.ts";
import { loadFileRefRows } from "./load-save-file-refs.ts";
import { createRecordReadCheck } from "./record-read-check.ts";
import {
  createRecordWriteCheck,
  isStoredRecordLocked,
  RecordWriteDecisions,
} from "./record-write-check.ts";

export type RebindFileRefContext = {
  readonly db: TenantDb;
  readonly registry: Registry;
  readonly user: SessionUser;
  // A job has no plain query dispatch; as the system user it skips the checks that need one.
  readonly dispatch?: CanReadFileRefContext["dispatch"];
};

type CallerCheckContext = CanReadFileRefContext & { readonly db: TenantDb };

export type FileRefOwner = {
  readonly entityType: string;
  readonly entityId: string;
  readonly fieldName: string;
};

export type RebindFileRefOutcome = "rebound" | "not-found" | "moved" | "version-conflict";

const CONCURRENT_WRITE_ERROR_CODES: readonly string[] = ["version_conflict", "unique_violation"];

type LoadedRow = { readonly fileRef: FileRef; readonly version: number };

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

// The file guard (and an app's accessGuard) reads these columns; a row missing one is corrupt.
async function loadRow(
  ctx: RebindFileRefContext,
  fileRefId: string,
): Promise<LoadedRow | undefined> {
  if (!isUuid(fileRefId)) return undefined;
  const row = (await loadFileRefRows(ctx.db, [fileRefId], ctx.user.tenantId)).get(fileRefId);
  if (row === undefined) return undefined;
  const { tenantId, storageKey, fileName, mimeType, size, entityType, entityId, fieldName } = row;
  const { insertedById, version } = row;
  if (
    typeof tenantId !== "string" ||
    typeof storageKey !== "string" ||
    typeof fileName !== "string" ||
    typeof mimeType !== "string" ||
    typeof size !== "number" ||
    typeof version !== "number" ||
    !nullableString(entityType) ||
    !nullableString(entityId) ||
    !nullableString(fieldName) ||
    !nullableString(insertedById)
  ) {
    return undefined;
  }
  return {
    fileRef: {
      id: fileRefId,
      tenantId,
      storageKey,
      fileName,
      mimeType,
      size,
      entityType,
      entityId,
      fieldName,
      insertedById,
    },
    version,
  };
}

function isOwnedBy(fileRef: FileRef, owner: FileRefOwner): boolean {
  return (
    fileRef.entityType === owner.entityType &&
    fileRef.entityId === owner.entityId &&
    fileRef.fieldName === owner.fieldName
  );
}

// A caller other than the system job must be able to read the file today, may not pull it off a
// locked record, and must be able to write the target field as a save of that record would.
async function assertCallerMayMove(
  ctx: CallerCheckContext,
  fileRef: FileRef,
  from: FileRefOwner,
  to: FileRefOwner,
): Promise<void> {
  if (!(await canCallerReadFileRef(ctx, fileRef))) {
    throw new AccessDeniedError({ message: `rebindFileRef: file ${fileRef.id} is not readable` });
  }
  const sourceLocked = await isStoredRecordLocked({
    registry: ctx.registry,
    db: ctx.db,
    entityType: from.entityType,
    entityId: from.entityId,
  });
  if (sourceLocked) {
    throw new RecordLockedError({ entityName: from.entityType, entityId: from.entityId });
  }
  const canWriteRecord = createRecordWriteCheck({
    registry: ctx.registry,
    canReadRecord: createRecordReadCheck(ctx.registry, (qn, payload) =>
      ctx.dispatch.query(qn, payload),
    ),
    tenantDbFor: () => ctx.db,
  });
  const decision = await canWriteRecord({ ...to, user: ctx.user });
  if (decision !== RecordWriteDecisions.writable) {
    throw new AccessDeniedError({
      message: `rebindFileRef: ${to.entityType}.${to.fieldName} of ${to.entityId} is not writable`,
      details: { decision },
    });
  }
}

/**
 * Moves a bound file from one record's file field to another's, for a record that takes over a
 * file uploaded elsewhere (an upload record, a mail attachment). Server code only; pending uploads
 * go through bindPendingFileRef.
 *
 * Only files of the caller's tenant are found ("not-found" otherwise, as for unknown ids). The
 * file must still sit at `from`; "moved" means it does not (any more), for example because a
 * parallel rebind took it first. A file already at `to` answers "rebound" without a write. The
 * target must be a registered file field whose accept/maxSize the file fits (InternalError /
 * UnprocessableError). Unless the caller is the framework system user, the caller must be able
 * to read the file, `from` must not be locked, and the caller must be able to write the target
 * record and field (AccessDeniedError, RecordLockedError). The update is checked against the
 * stream version read here, so a bind committing in between returns "version-conflict".
 * A handler passes its ctx; a job passes `{ db, registry, user: ctx.systemUser }`.
 */
export async function rebindFileRef(
  ctx: RebindFileRefContext,
  args: { readonly fileRefId: string; readonly from: FileRefOwner; readonly to: FileRefOwner },
): Promise<RebindFileRefOutcome> {
  const { fileRefId, from, to } = args;
  const loaded = await loadRow(ctx, fileRefId);
  if (loaded === undefined) return "not-found";
  const { fileRef, version } = loaded;
  if (isOwnedBy(fileRef, to)) return "rebound";
  if (!isOwnedBy(fileRef, from)) return "moved";

  assertRowFitsBindTarget(
    ctx.registry,
    { entityName: to.entityType, fieldName: to.fieldName },
    fileRef,
  );
  if (!isFrameworkSystemUser(ctx.user)) {
    const { dispatch } = ctx;
    if (dispatch === undefined) {
      throw new InternalError({
        message: "rebindFileRef: a caller other than the system user needs ctx.dispatch.query",
      });
    }
    await assertCallerMayMove({ ...ctx, dispatch }, fileRef, from, to);
  }

  const moved = await getFileRefExecutor().update(
    {
      id: fileRefId,
      version,
      changes: { entityType: to.entityType, entityId: to.entityId, fieldName: to.fieldName },
    },
    ctx.user,
    ctx.db,
  );
  if (moved.isSuccess) return "rebound";
  if (CONCURRENT_WRITE_ERROR_CODES.includes(moved.error.code)) return "version-conflict";
  throw reraiseAsKumikoError(moved.error);
}
