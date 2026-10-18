import { selectMany } from "../db/query.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import { tenantDbRunner } from "../db/tenant-db-runner.ts";
import {
  isFileField,
  type Registry,
  type SaveContext,
  type SessionUser,
} from "../engine/types/index.ts";
import { getStreamVersions } from "../event-store/event-store.ts";
import { fileRefIdsOf } from "./bind-pending-file-refs.ts";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.ts";
import { fileRefsTable } from "./file-ref-table.ts";

export type FileRefRows = ReadonlyMap<string, Readonly<Record<string, unknown>>>;

// One query for every fileRef a save names, restricted to the writer's own tenant and live
// rows: the tenant check and the pending-upload binding both work from this map instead of
// reading each row again inside the write transaction.
export async function loadSaveFileRefs(args: {
  readonly registry: Registry;
  readonly result: SaveContext;
  readonly user: SessionUser;
  readonly db: TenantDb;
}): Promise<FileRefRows> {
  const { registry, result, user, db } = args;
  const entity =
    result.entityName === undefined ? undefined : registry.getEntity(result.entityName);
  // skip: saves of unregistered or unnamed aggregates declare no file fields
  if (entity === undefined) return new Map();
  // skip: without the files feature the file_refs table is not part of the schema
  if (registry.getEntity(FILE_REF_ENTITY_NAME) === undefined) return new Map();

  const ids = new Set<string>();
  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!isFileField(fieldDef)) continue;
    for (const id of fileRefIdsOf(result.changes[fieldName])) ids.add(id);
  }
  return loadFileRefRows(db, [...ids], user.tenantId);
}

// One query for the given live fileRefs of one tenant. Each row carries the stream version as
// `version`: the binding update needs it as expectedVersion, and events without a projection
// effect (e.g. ingest requests) advance the stream but not the row's version column.
export async function loadFileRefRows(
  db: TenantDb,
  ids: readonly string[],
  tenantId: SessionUser["tenantId"],
): Promise<FileRefRows> {
  // skip: nothing referenced, nothing to load
  if (ids.length === 0) return new Map();
  const rows = await selectMany<Record<string, unknown>>(db, fileRefsTable, {
    id: { in: [...ids] },
    tenantId,
    isDeleted: false,
  });
  const streamVersions = await getStreamVersions(
    tenantDbRunner(db),
    rows.map((row) => String(row["id"])),
    db.tenantId,
  );
  return new Map(
    rows.map((row) => {
      const id = String(row["id"]);
      const streamVersion = streamVersions.get(id);
      return [id, streamVersion === undefined ? row : { ...row, version: streamVersion }];
    }),
  );
}
