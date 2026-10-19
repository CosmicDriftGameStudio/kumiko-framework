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
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefEntity, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
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

  for (const fileEntity of collectFileEntities(registry)) {
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
  if (firstFailure) throw firstFailure;
}
