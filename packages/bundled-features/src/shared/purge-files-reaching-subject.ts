import {
  resolveSubjectForField,
  type SubjectId,
  SubjectResolutionError,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
  selectMany,
  type WhereObject,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type EntityDefinition,
  parseTenantId,
  type Registry,
  SYSTEM_USER_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  FILE_REF_ENTITY_NAME,
  fileRefEntity,
  fileRefsTable,
  listActionFormFileFields,
} from "@cosmicdrift/kumiko-framework/files";
import {
  collectSingleFileHolders,
  type FileRefPurgeOutcome,
  planFileFields,
  purgeRowFileRefs,
  type SingleFileHolder,
} from "./purge-row-file-refs.ts";

// Callers' error labels read err.code, so audit events name the failure class.
export class FileSweepError extends Error {
  constructor(
    readonly code: Exclude<FileRefPurgeOutcome, "purged">,
    readonly entityName: string,
  ) {
    super(`[files-purge] ${code} while purging files of entity ${entityName}`);
    this.name = "FileSweepError";
  }
}

type FileEntity = {
  readonly entityName: string;
  readonly entity: EntityDefinition;
  readonly table: Parameters<typeof selectMany>[1];
  readonly fileFields: readonly string[];
};

function collectFileEntities(registry: Registry): readonly FileEntity[] {
  const found: FileEntity[] = [];
  for (const proj of registry.getAllProjections().values()) {
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entity = registry.getEntity(proj.source);
    if (!entity) continue;
    const { singleFields, multiFields } = planFileFields(entity.fields);
    const fileFields = [...singleFields, ...multiFields];
    if (fileFields.length === 0) continue;
    found.push({ entityName: proj.source, entity, table: proj.table, fileFields });
  }
  return found;
}

// Candidate rows only; the exact per-field subject is verified with resolveSubjectForField,
// the same resolver that encrypted the field.
function candidateWheres(
  subject: SubjectId,
  recordTenantId: TenantId | undefined,
  { entityName, entity, fileFields }: FileEntity,
): readonly WhereObject[] {
  if (subject.kind === "record") {
    // Without the owning tenant the record cannot be told apart from a same-id row elsewhere.
    return entityName === subject.entity && recordTenantId !== undefined
      ? [{ id: subject.id, tenantId: recordTenantId }]
      : [];
  }
  if (subject.kind !== "user") return [];
  const wheres: WhereObject[] = [];
  for (const fieldName of fileFields) {
    const field = entity.fields[fieldName];
    if (field && "userOwned" in field && field.userOwned !== undefined) {
      wheres.push({ [field.userOwned.ownerField]: subject.userId });
    } else if (field && "pii" in field && field.pii === true && entity.idType !== "serial") {
      wheres.push({ id: subject.userId });
    }
  }
  return wheres;
}

function fieldsResolvingToSubject(
  fileEntity: FileEntity,
  row: Record<string, unknown>,
  rowTenantId: TenantId,
  subjectKey: string,
): readonly string[] {
  return fileEntity.fileFields.filter((fieldName) => {
    try {
      const resolved = resolveSubjectForField(fileEntity.entity, fieldName, row, {
        tenantId: rowTenantId,
        entityName: fileEntity.entityName,
      });
      return resolved !== null && subjectIdToKey(resolved) === subjectKey;
    } catch (err) {
      // skip: a field whose owner cannot be resolved on this row never encrypted under this subject
      if (err instanceof SubjectResolutionError) return false;
      throw err;
    }
  });
}

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

export type DeleteFileBytes = (storageKey: string) => Promise<readonly string[]>;

// What to do when a tenant has files to delete but no storage: fail closed (the files would
// leak while the erasure reads as done) or skip with a warning, for callers whose erasure must
// not be blocked forever by a misconfigured store.
export type MissingStoragePolicy =
  | { readonly mode: "fail" }
  | { readonly mode: "skip"; readonly warn: (tenantId: TenantId) => void };

async function deleteBytesFailingClosed(
  deleteBytes: DeleteFileBytes,
  storageKey: string,
): Promise<readonly string[]> {
  try {
    return await deleteBytes(storageKey);
  } catch {
    // skip: an unsafe key or missing list permission fails this file closed, not the whole sweep
    return [storageKey];
  }
}

// Forgetting a subject erases keys; the files behind a personal file field are not ciphertext,
// so they need their own purge (bytes, derivatives, fileRef rows). The entity row stays:
// forgetting is crypto-shredding, not deletion. Tenant subjects are covered by
// files-tenant-data on tenant destroy. The storage is resolved per owning tenant because a
// subject's rows can live in any tenant.
export async function purgeFilesReachingSubject(args: {
  readonly registry: Registry;
  readonly db: DbRunner;
  readonly subject: SubjectId;
  readonly subjectKey: string;
  // Tenant owning the row of a record subject; a record subject without it purges nothing.
  readonly recordTenantId?: TenantId;
  readonly resolveDeleteBytes: (tenantId: TenantId) => Promise<DeleteFileBytes | undefined>;
  readonly missingStorage: MissingStoragePolicy;
}): Promise<void> {
  const { registry, db, subject, subjectKey, recordTenantId, resolveDeleteBytes, missingStorage } =
    args;
  // skip: tenant subjects are covered by files-tenant-data on tenant destroy
  if (subject.kind === "tenant") return;

  const fileHolders: readonly SingleFileHolder[] = collectSingleFileHolders(registry);
  const storageByTenant = new Map<TenantId, Promise<DeleteFileBytes | undefined>>();
  let firstFailure: FileSweepError | undefined;

  const fileEntities = collectFileEntities(registry);
  for (const fileEntity of fileEntities) {
    const seenRowIds = new Set<string>();
    for (const where of candidateWheres(subject, recordTenantId, fileEntity)) {
      const rows = await selectMany<Record<string, unknown>>(db, fileEntity.table, where);
      for (const row of rows) {
        const rowId = String(row["id"]);
        const tenantId = parseTenantId(row["tenantId"]);
        // skip: a row without a tenant cannot own tenant-scoped file refs
        if (seenRowIds.has(rowId) || tenantId === null) continue;
        seenRowIds.add(rowId);

        const fieldNames = fieldsResolvingToSubject(fileEntity, row, tenantId, subjectKey);
        // skip: none of the row's file fields belongs to this subject
        if (fieldNames.length === 0) continue;

        let storagePromise = storageByTenant.get(tenantId);
        if (storagePromise === undefined) {
          storagePromise = resolveDeleteBytes(tenantId);
          storageByTenant.set(tenantId, storagePromise);
        }
        const deleteBytes = await storagePromise;
        const systemUser = createSystemUser(tenantId);
        const tdb = createTenantDb({ db, tenantId, mode: "system" });

        const outcome = await purgeRowFileRefs({
          db,
          tenantId,
          entityName: fileEntity.entityName,
          entity: fileEntity.entity,
          table: fileEntity.table,
          fileHolders,
          row,
          fieldNames,
          deleteBytes: deleteBytes
            ? (key) => deleteBytesFailingClosed(deleteBytes, key)
            : undefined,
          fileRefForget: async (fileRefId) =>
            (await fileRefExecutor.forget({ id: fileRefId }, systemUser, tdb)).isSuccess,
        });
        if (outcome === "missing_file_storage" && missingStorage.mode === "skip") {
          missingStorage.warn(tenantId);
        } else if (outcome !== "purged") {
          firstFailure ??= new FileSweepError(outcome, fileEntity.entityName);
        }
      }
    }
  }
  // Runs even after an entity-sweep failure: one failed row must not leave the pending uploads.
  const pendingFailure = await purgePendingUploadsOfUser({
    db,
    registry,
    subject,
    fileFieldKeys: pendingFieldKeys(fileEntities, registry),
    fileHolders,
    storageByTenant,
    resolveDeleteBytes,
    missingStorage,
  });
  firstFailure ??= pendingFailure;
  if (firstFailure) throw firstFailure;
}

const pendingFieldKey = (entityType: unknown, fieldName: unknown) =>
  `${entityType}\u0000${fieldName}`;

// A pending upload of an actionForm files field is keyed by the screen QN, like an entity's by its name.
function pendingFieldKeys(
  fileEntities: readonly FileEntity[],
  registry: Registry,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const { screenQn, fieldName } of listActionFormFileFields(registry)) {
    keys.add(pendingFieldKey(screenQn, fieldName));
  }
  for (const { entityName, fileFields } of fileEntities) {
    for (const fieldName of fileFields) keys.add(pendingFieldKey(entityName, fieldName));
  }
  return keys;
}

async function isFileRefHeldByRecord(
  db: DbRunner,
  holders: readonly SingleFileHolder[],
  tenantId: TenantId,
  fileRefId: string,
): Promise<boolean> {
  for (const holder of holders) {
    for (const field of holder.singleFields) {
      const where: WhereObject = { [field]: fileRefId };
      if (holder.tableHasTenantId) where["tenantId"] = tenantId;
      if ((await selectMany(db, holder.table, where, { limit: 1 })).length > 0) return true;
    }
  }
  return false;
}

// An upload the user made but never bound to a record has no entity row to find it through, so
// the uploader id is the only link. Only refs that originate from a registered entity file
// field count as pending uploads: config saves (a tenant logo) and server-made files never
// bind and must outlive the uploader. A legacy unbound ref a record's single file column still
// names is not pending but in use and stays with that record.
async function purgePendingUploadsOfUser(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly subject: SubjectId;
  readonly fileFieldKeys: ReadonlySet<string>;
  readonly fileHolders: readonly SingleFileHolder[];
  readonly storageByTenant: Map<TenantId, Promise<DeleteFileBytes | undefined>>;
  readonly resolveDeleteBytes: (tenantId: TenantId) => Promise<DeleteFileBytes | undefined>;
  readonly missingStorage: MissingStoragePolicy;
}): Promise<FileSweepError | undefined> {
  const { db, registry, subject, fileFieldKeys } = args;
  // skip: only a user uploads files without binding them to a record
  if (subject.kind !== "user") return undefined;
  // skip: the system user is not a person; its server-made files are not pending uploads
  if (subject.userId === SYSTEM_USER_ID) return undefined;
  // skip: without the files feature there is no file_refs table to sweep
  if (registry.getEntity(FILE_REF_ENTITY_NAME) === undefined) return undefined;
  const pending = await selectMany<Record<string, unknown>>(db, fileRefsTable, {
    insertedById: subject.userId,
    entityId: null,
  });
  let firstFailure: FileSweepError | undefined;
  for (const fileRef of pending) {
    // skip: not uploaded for a registered entity file field (config, server-made, unknown origin)
    if (!fileFieldKeys.has(pendingFieldKey(fileRef["entityType"], fileRef["fieldName"]))) continue;
    firstFailure ??= await purgePendingFileRef(args, fileRef);
  }
  return firstFailure;
}

async function purgePendingFileRef(
  args: {
    readonly db: DbRunner;
    readonly fileHolders: readonly SingleFileHolder[];
    readonly storageByTenant: Map<TenantId, Promise<DeleteFileBytes | undefined>>;
    readonly resolveDeleteBytes: (tenantId: TenantId) => Promise<DeleteFileBytes | undefined>;
    readonly missingStorage: MissingStoragePolicy;
  },
  fileRef: Record<string, unknown>,
): Promise<FileSweepError | undefined> {
  const { db, fileHolders, storageByTenant, resolveDeleteBytes, missingStorage } = args;
  const tenantId = parseTenantId(fileRef["tenantId"]);
  const fileRefId = String(fileRef["id"]);
  const storageKey = fileRef["storageKey"];
  // skip: a ref without tenant or key has no bytes this sweep could address
  if (tenantId === null || typeof storageKey !== "string" || storageKey === "") return undefined;
  // skip: a record still uses this file
  if (await isFileRefHeldByRecord(db, fileHolders, tenantId, fileRefId)) return undefined;

  let storagePromise = storageByTenant.get(tenantId);
  if (storagePromise === undefined) {
    storagePromise = resolveDeleteBytes(tenantId);
    storageByTenant.set(tenantId, storagePromise);
  }
  const deleteBytes = await storagePromise;
  if (deleteBytes === undefined) {
    if (missingStorage.mode === "skip") {
      missingStorage.warn(tenantId);
      return undefined;
    }
    return new FileSweepError("missing_file_storage", FILE_REF_ENTITY_NAME);
  }
  if ((await deleteBytesFailingClosed(deleteBytes, storageKey)).length > 0) {
    return new FileSweepError("file_delete_failed", FILE_REF_ENTITY_NAME);
  }
  const forgotten = await fileRefExecutor.forget(
    { id: fileRefId },
    createSystemUser(tenantId),
    createTenantDb({ db, tenantId, mode: "system" }),
  );
  return forgotten.isSuccess
    ? undefined
    : new FileSweepError("file_delete_failed", FILE_REF_ENTITY_NAME);
}
