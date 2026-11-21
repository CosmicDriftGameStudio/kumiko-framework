import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { inboundFolderTable } from "./schema/inbound-folder.ts";
import { inboundItemTable } from "./schema/inbound-item.ts";

type Db = HandlerContext["db"];

// Folders under a "delete folder" click, the clicked ones included: their files no longer count.
// ponytail: the ids go into one IN list; thousands of folders below deleting roots would need the sums per idPath prefix.
export async function deletingFolderIds(db: Db): Promise<readonly string[]> {
  const roots = await selectMany<{ id: string; idPath: string; connectorId: string }>(
    db,
    inboundFolderTable,
    { deleting: true },
    { fields: ["id", "idPath", "connectorId"] },
  );
  if (roots.length === 0) return [];
  const prefixes = roots.map((root) => `${root.idPath}${root.id}/`);
  const folders = await selectMany<{ id: string; idPath: string }>(
    db,
    inboundFolderTable,
    { connectorId: { in: [...new Set(roots.map((root) => root.connectorId))] } },
    { fields: ["id", "idPath"] },
  );
  const ids = new Set(roots.map((root) => root.id));
  for (const folder of folders) {
    if (prefixes.some((prefix) => folder.idPath.startsWith(prefix))) ids.add(folder.id);
  }
  return [...ids];
}

// Bytes of the files that stay: the total minus what sits in deleting folders.
export async function storedBytes(db: Db): Promise<number> {
  const [total] = await db.aggregate(inboundItemTable, {
    measure: { fn: "sum", field: "sizeBytes" },
  });
  const doomed = await deletingFolderIds(db);
  if (doomed.length === 0) return total?.value ?? 0;
  const [removed] = await db.aggregate(
    inboundItemTable,
    { measure: { fn: "sum", field: "sizeBytes" } },
    { folderId: { in: [...doomed] } },
  );
  return (total?.value ?? 0) - (removed?.value ?? 0);
}

// Bytes still in the file store, files in deleting folders included. The quota takes this one, not
// `storedBytes`: if the deletion job hangs, upload-delete-upload must still hit the limit, since the bytes stay until the sweep ran.
export async function physicalStoredBytes(db: Db): Promise<number> {
  const [total] = await db.aggregate(inboundItemTable, {
    measure: { fn: "sum", field: "sizeBytes" },
  });
  return total?.value ?? 0;
}
