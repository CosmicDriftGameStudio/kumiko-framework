import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { collectEntityDetailQueries } from "../api/entity-read-access.ts";
import { isReadRestrictedField } from "../engine/field-access.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import { isKumikoError } from "../errors/index.ts";
import { createFallbackLogger } from "../logging/index.ts";
import { fileRefIdsInField, holdsFileRefs } from "./file-field-slots.ts";

type AttachedFile = { readonly id: string; readonly fieldName: string | null };

export type RecordReadCheck = (args: {
  readonly entityType: string;
  readonly entityId: string;
  readonly user: SessionUser;
  // Set when the question is about one file of the record rather than the record itself.
  readonly file?: AttachedFile;
}) => Promise<boolean>;

type QueryAsUser = (type: string, payload: unknown, user: SessionUser) => Promise<unknown>;

const log = createFallbackLogger("files");

// "May this user read the record?" is answered by the entity's own detail
// query run as that user: handler access, row ownership and parent visibility
// all apply, exactly as when the record is opened. null (not found or not
// visible) and access errors mean no. Entities without a detail query never
// grant access this way.
export function createRecordReadCheck(registry: Registry, query: QueryAsUser): RecordReadCheck {
  let detailQueryByEntity: ReadonlyMap<string, string> | undefined;
  return async ({ entityType, entityId, user, file }) => {
    detailQueryByEntity ??= collectEntityDetailQueries(registry);
    const detailQuery = detailQueryByEntity.get(entityType);
    if (detailQuery === undefined) return false;
    try {
      const record = await query(detailQuery, { id: entityId }, user);
      if (record === null || record === undefined) return false;
      return file === undefined || recordShowsFile(registry, entityType, file, record);
    } catch (error) {
      if (!isKumikoError(error) || error.httpStatus >= 500) {
        log.error("record read check failed; file access denied", {
          entityType,
          detailQuery,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  };
}

// The detail query strips the fields the caller may not read, so once the entity has a
// read-restricted file field, a file opens only while some file field of the returned record
// still carries it. That field, not file_refs.fieldName, decides: a save may move an id between
// the record's own file fields and the binding stays at the field it was uploaded for. Entities
// without such a field stay open to every record reader, whatever shape their detail query has.
function recordShowsFile(
  registry: Registry,
  entityType: string,
  file: AttachedFile,
  record: unknown,
): boolean {
  if (file.fieldName === null) return true;
  const entity = registry.getEntity(entityType) ?? registry.getReadModelEntity(entityType);
  if (entity?.fields[file.fieldName] === undefined) return true;
  const fileFields = Object.entries(entity.fields).filter(([, field]) => holdsFileRefs(field));
  if (!fileFields.some(([, field]) => isReadRestrictedField(field))) return true;
  return fileFields.some(([name, field]) =>
    fileRefIdsInField(field, propertyOf(record, name)).includes(file.id),
  );
}
