import { isAnonymousSessionUser, SYSTEM_USER_ID } from "../engine/system-user.ts";
import type { FileAccessGuard } from "./file-routes.ts";
import type { RecordReadCheck } from "./record-read-check.ts";

export const DEFAULT_PRIVILEGED_ROLES = ["TenantAdmin", "Admin", "SystemAdmin"] as const;

// Default guard: the uploader and a privileged role get every file, attached, pending or
// unclaimed; on a record-only entity type the privileged role gets no shortcut and the record
// decides. For reads, the unclaimed-upload readers also get uploads no record can claim, and
// everyone who may read the record gets its attached files. Delete stays with the uploader and
// privileged roles: reading a record is no right to remove its files.
export function createDefaultGuard(
  privilegedRoles: readonly string[],
  canReadRecord: RecordReadCheck | undefined,
  unclaimedUploadReaders: readonly string[],
  recordOnlyEntityTypes: ReadonlySet<string>,
): FileAccessGuard {
  return async ({ fileRef, user, operation }) => {
    // Every anonymous visitor shares one user id, so insertedById proves no ownership for them.
    if (isAnonymousSessionUser(user)) return "deny";
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
