import { isUuid } from "@cosmicdrift/kumiko-types/identifiers";
import { isFrameworkSystemUser } from "../db/lock-guard.ts";
import { selectRowForUpdateById } from "../db/queries/entity-read.ts";
import { asEntityTableMeta } from "../db/table-introspection.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import { tenantDbRunner } from "../db/tenant-db-runner.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import { RecordLockedError } from "../errors/classes.ts";
import {
  AccessDeniedError,
  InternalError,
  NotFoundError,
  reraiseAsKumikoError,
} from "../errors/index.ts";
import { assertRowFitsBindTarget } from "./bind-pending-file-refs.ts";
import { type CanReadFileRefContext, canCallerReadFileRef } from "./can-caller-read-file-ref.ts";
import { getFileRefExecutor } from "./create-file-ref.ts";
import type { FileRef } from "./file-routes.ts";
import { loadFileRefRows } from "./load-save-file-refs.ts";
import { createRecordReadCheck } from "./record-read-check.ts";
import {
  createRecordWriteCheck,
  findImplicitEntityTable,
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

// Holds the source row until commit, so a lock or ownership change committed by another
// transaction is either seen by the write check below or waits for this rebind to finish.
async function lockSourceRow(ctx: CallerCheckContext, from: FileRefOwner): Promise<void> {
  const table = findImplicitEntityTable(ctx.registry, from.entityType);
  const tableName = asEntityTableMeta(table)?.tableName;
  // skip: no stored row to lock; the write check below answers not_found for it
  if (tableName === undefined) return;
  await selectRowForUpdateById(tenantDbRunner(ctx.db), tableName, from.entityId);
}

// A caller other than the system job must be able to read the file today and must be able to
// write both records as a save of them would: the source it takes the file from (unlocked, and
// with an update handler the caller passes; without one only the system job may move the file),
// and the target field it puts the file into.
async function assertCallerMayMove(
  ctx: CallerCheckContext,
  fileRef: FileRef,
  from: FileRefOwner,
  to: FileRefOwner,
): Promise<void> {
  if (!(await canCallerReadFileRef(ctx, fileRef))) {
    throw new AccessDeniedError({ message: `rebindFileRef: file ${fileRef.id} is not readable` });
  }
  const canWriteRecord = createRecordWriteCheck({
    registry: ctx.registry,
    canReadRecord: createRecordReadCheck(ctx.registry, (qn, payload) =>
      ctx.dispatch.query(qn, payload),
    ),
    tenantDbFor: () => ctx.db,
  });
  await lockSourceRow(ctx, from);
  const sourceDecision = await canWriteRecord({ ...from, user: ctx.user });
  if (sourceDecision === RecordWriteDecisions.locked) {
    throw new RecordLockedError({ entityName: from.entityType, entityId: from.entityId });
  }
  if (sourceDecision !== RecordWriteDecisions.writable) {
    throw new AccessDeniedError({
      message: `rebindFileRef: source ${from.entityType}.${from.fieldName} of ${from.entityId} is not writable`,
      details: { decision: sourceDecision },
    });
  }
  const decision = await canWriteRecord({ ...to, user: ctx.user });
  if (decision !== RecordWriteDecisions.writable) {
    throw new AccessDeniedError({
      message: `rebindFileRef: ${to.entityType}.${to.fieldName} of ${to.entityId} is not writable`,
      details: { decision },
    });
  }
}

// The caller checks find the target as a side effect; the system path needs its own lookup so a
// job cannot point a file at a record that does not exist in its tenant.
async function assertTargetRecordExists(
  ctx: RebindFileRefContext,
  to: FileRefOwner,
): Promise<void> {
  const entity = ctx.registry.getEntity(to.entityType);
  const table = findImplicitEntityTable(ctx.registry, to.entityType);
  const row =
    entity === undefined || table === undefined
      ? undefined
      : await ctx.db.fetchOne<Record<string, unknown>>(table, {
          id: to.entityId,
          ...(entity.softDelete === true && { isDeleted: false }),
        });
  if (row === undefined) throw new NotFoundError(to.entityType, to.entityId);
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
 * to read the file and to write both the source record and field (it must not be locked, and an
 * entity without update handler leaves the move to the system user) and the target record and
 * field (AccessDeniedError, RecordLockedError); the system user skips these checks, and only the
 * target record has to exist (NotFoundError). The update is checked against the file's stream
 * version read here, so a bind committing in between returns "version-conflict"; the source row
 * stays locked until the surrounding transaction commits, so a lock set on `from` in between is
 * either seen or waits. Rebind first, then save the id into
 * the target field: the save accepts a file already bound to that record, and the source record
 * no longer disposes of it when its field is cleared or the record is deleted.
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
  if (isFrameworkSystemUser(ctx.user)) {
    await assertTargetRecordExists(ctx, to);
  } else {
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
