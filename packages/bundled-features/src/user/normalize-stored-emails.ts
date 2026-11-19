import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  type LocalKeyKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import { type DbRunner, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { VERSION_CONFLICT_CODE } from "@cosmicdrift/kumiko-framework/errors";
import { normalizeEmail } from "../shared/index.ts";
import { USER_STATUS, userTable } from "./schema/user.ts";
import {
  rewriteSeededUserEmail,
  UserEmailRewriteError,
  type UserEmailRewriteOutcome,
} from "./seeding.ts";

export type StoredEmailNormalizationResult = {
  readonly rewrittenUserIds: readonly string[];
  // The lower-case address already belongs to another account, live or in its deletion grace
  // period (the unique index is not partial); merging is a business decision.
  readonly duplicateUserIds: readonly string[];
  readonly versionConflictUserIds: readonly string[];
  readonly undecryptableUserIds: readonly string[];
  // Any other failure, by code only: messages and details can carry the address.
  readonly failedUsers: readonly { readonly userId: string; readonly code: string }[];
};

function failureCode(e: unknown): string {
  if (e instanceof UserEmailRewriteError) return e.code;
  return e instanceof Error ? e.name : "unknown";
}

async function readStoredEmail(
  row: Record<string, unknown>,
  kms: LocalKeyKmsAdapter | undefined,
): Promise<unknown> {
  // skip: without a PII KMS the column holds plaintext
  if (kms === undefined) return row["email"];
  const decrypted = await decryptPiiFieldValues({ email: row["email"] }, ["email"], kms, {
    requestId: "normalize-stored-emails",
  });
  return decrypted["email"];
}

// Accounts stored before emails were lower-cased are unreachable for every lookup, which
// lower-cases its input. Rewrites go through the executor, so the event and the blind index follow.
export async function normalizeStoredUserEmails(
  db: DbRunner,
  options: { readonly signal?: AbortSignal } = {},
): Promise<StoredEmailNormalizationResult> {
  const kms = configuredPiiSubjectKms();
  const by = createSystemUser(SYSTEM_TENANT_ID);
  const rows = await selectMany(db, userTable, {
    isDeleted: false,
    status: { ne: USER_STATUS.Deleted },
  });
  const rewrittenUserIds: string[] = [];
  const duplicateUserIds: string[] = [];
  const versionConflictUserIds: string[] = [];
  const undecryptableUserIds: string[] = [];
  const failedUsers: { userId: string; code: string }[] = [];
  for (const row of rows) {
    if (options.signal?.aborted) break;
    const id = String(row["id"]);
    let storedEmail: unknown;
    try {
      storedEmail = await readStoredEmail(row, kms);
    } catch {
      undecryptableUserIds.push(id);
      continue;
    }
    if (typeof storedEmail !== "string" || storedEmail === normalizeEmail(storedEmail)) continue;
    let outcome: UserEmailRewriteOutcome;
    try {
      outcome = await rewriteSeededUserEmail(db, row, normalizeEmail(storedEmail), by);
    } catch (e) {
      failedUsers.push({ userId: id, code: failureCode(e) });
      continue;
    }
    if (outcome === "rewritten") rewrittenUserIds.push(id);
    else if (outcome === "unique_violation") duplicateUserIds.push(id);
    else if (outcome === VERSION_CONFLICT_CODE) versionConflictUserIds.push(id);
  }
  return {
    rewrittenUserIds,
    duplicateUserIds,
    versionConflictUserIds,
    undecryptableUserIds,
    failedUsers,
  };
}
