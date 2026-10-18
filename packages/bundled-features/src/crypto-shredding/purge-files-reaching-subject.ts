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
import { deleteFileRefBytes } from "@cosmicdrift/kumiko-framework/derivatives";
import {
  createSystemUser,
  type EntityDefinition,
  type HandlerContext,
  parseTenantId,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFileContext,
  type FileContext,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import {
  collectSingleFileHolders,
  type FileRefPurgeOutcome,
  planFileFields,
  purgeRowFileRefs,
  type SingleFileHolder,
} from "../shared/index.ts";

const ERROR_CONTEXT = "crypto-shredding:forget-subject";

// sweepErrorLabel in the handler reads err.code, so the audit event names the failure class.
export class FileSweepError extends Error {
  constructor(
    readonly code: Exclude<FileRefPurgeOutcome, "purged">,
    readonly entityName: string,
  ) {
    super(`[${ERROR_CONTEXT}] ${code} while purging files of entity ${entityName}`);
    this.name = "FileSweepError";
  }
}

type FileEntity = {
  readonly entityName: string;
  readonly entity: EntityDefinition;
  readonly table: Parameters<typeof selectMany>[1];
  readonly fileFields: readonly string[];
};

function collectFileEntities(ctx: HandlerContext): readonly FileEntity[] {
  const found: FileEntity[] = [];
  for (const proj of ctx.registry.getAllProjections().values()) {
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entity = ctx.registry.getEntity(proj.source);
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
  { entityName, entity, fileFields }: FileEntity,
): readonly WhereObject[] {
  if (subject.kind === "record") return entityName === subject.entity ? [{ id: subject.id }] : [];
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

// The upload resolver, not ctx.files: ctx.files is bound to the acting user's tenant, while
// a subject's rows can live in any tenant. Resolved eagerly so a missing provider surfaces as
// missing_file_storage instead of a failed delete.
async function resolveFilesForTenant(
  ctx: HandlerContext,
  tenantId: TenantId,
): Promise<FileContext | undefined> {
  const resolver = ctx._fileProviderResolver;
  if (resolver === undefined) return tenantId === ctx.user.tenantId ? ctx.files : undefined;
  try {
    const provider = await resolver(tenantId);
    return createFileContext(() => Promise.resolve(provider), tenantId);
  } catch {
    // skip: no provider resolvable for this tenant; surfaces as missing_file_storage when files exist
    return undefined;
  }
}

async function deleteBytesFailingClosed(
  files: FileContext,
  storageKey: string,
): Promise<readonly string[]> {
  try {
    return await deleteFileRefBytes(files, { storageKey }, ERROR_CONTEXT);
  } catch {
    // skip: an unsafe key or missing list permission fails this file closed, not the whole sweep
    return [storageKey];
  }
}

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

// forget-subject erases the key; the files behind a personal file field are not
// ciphertext, so they need their own purge (bytes, derivatives, fileRef rows). The entity row
// stays: forgetting is crypto-shredding, not deletion. Tenant subjects are covered by
// files-tenant-data on tenant destroy.
export async function purgeFilesReachingSubject(args: {
  readonly ctx: HandlerContext;
  readonly db: DbRunner;
  readonly subject: SubjectId;
  readonly subjectKey: string;
}): Promise<void> {
  const { ctx, db, subject, subjectKey } = args;
  if (subject.kind === "tenant") return;

  const fileHolders: readonly SingleFileHolder[] = collectSingleFileHolders(ctx.registry);
  const filesByTenant = new Map<TenantId, Promise<FileContext | undefined>>();
  let firstFailure: FileSweepError | undefined;

  for (const fileEntity of collectFileEntities(ctx)) {
    const seenRowIds = new Set<string>();
    for (const where of candidateWheres(subject, fileEntity)) {
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

        let filesPromise = filesByTenant.get(tenantId);
        if (filesPromise === undefined) {
          filesPromise = resolveFilesForTenant(ctx, tenantId);
          filesByTenant.set(tenantId, filesPromise);
        }
        const files = await filesPromise;
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
          deleteBytes: files ? (key) => deleteBytesFailingClosed(files, key) : undefined,
          fileRefForget: async (fileRefId) =>
            (await fileRefExecutor.forget({ id: fileRefId }, systemUser, tdb)).isSuccess,
        });
        if (outcome !== "purged") {
          firstFailure ??= new FileSweepError(outcome, fileEntity.entityName);
        }
      }
    }
  }
  if (firstFailure) throw firstFailure;
}
