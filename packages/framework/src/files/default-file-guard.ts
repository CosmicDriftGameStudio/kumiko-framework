import { SYSTEM_USER_ID } from "../engine/system-user.ts";
import type { FileAccessGuard } from "./file-routes.ts";
import type { RecordReadCheck } from "./record-read-check.ts";

export const DEFAULT_PRIVILEGED_ROLES = ["Admin", "SystemAdmin"] as const;

// Default guard: on attached files, allow the uploader or a privileged role,
// and for reads also everyone who may read the record. Delete stays with the
// uploader and privileged roles: reading a record is no right to remove its
// files. Pending uploads (entityType set, record not yet created) are the
// uploader's own until bound; so are uploads without an entityType, which no
// record can ever claim.
export function createDefaultGuard(
  privilegedRoles: readonly string[],
  canReadRecord: RecordReadCheck | undefined,
  unclaimedUploadReaders: readonly string[],
  recordOnlyEntityTypes: ReadonlySet<string>,
): FileAccessGuard {
  return async ({ fileRef, user, operation }) => {
    if (fileRef.insertedById === user.id) return "allow";
    const isRecordOnly =
      fileRef.entityType !== null && recordOnlyEntityTypes.has(fileRef.entityType);
    if (!isRecordOnly && hasAnyRole(user, privilegedRoles)) return "allow";
    if (
      isUnclaimedUpload(fileRef) &&
      operation === "read" &&
      hasAnyRole(user, unclaimedUploadReaders)
    ) {
      return "allow";
    }
    if (fileRef.entityType === null || fileRef.entityId === null) return "deny";
    if (operation !== "read" || canReadRecord === undefined) return "deny";
    const recordReadable = await canReadRecord({
      entityType: fileRef.entityType,
      entityId: fileRef.entityId,
      user,
    });
    return recordReadable ? "allow" : "deny";
  };
}

function hasAnyRole(
  user: { readonly roles: readonly string[] },
  roles: readonly string[],
): boolean {
  return roles.some((role) => user.roles.includes(role));
}

// System-generated documents are created without attachTo too, but belong to a person's data, not to an inbox.
function isUnclaimedUpload(fileRef: Parameters<FileAccessGuard>[0]["fileRef"]): boolean {
  return (
    fileRef.entityType === null &&
    fileRef.entityId === null &&
    fileRef.insertedById !== SYSTEM_USER_ID
  );
}
