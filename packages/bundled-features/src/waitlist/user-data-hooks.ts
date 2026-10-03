import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import type {
  UserDataDeleteHook,
  UserDataExportHook,
  UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { collectErasureFailure, decryptStoredPii, throwIfErasureFailed } from "../shared/index.js";
import { userTable } from "../user/index.js";
import { normalizeEmail, platformActor, waitlistExecutor } from "./lib.js";

const PII_DECRYPT_REASON = "waitlist:user-data";
const ERASE_REASON = "waitlist:user-data-forget";
const ENTRY_LOOKUP_LIMIT = 100;

// Entries are matched by email, so the user must have proven they own it:
// otherwise registering with someone else's address would expose or erase that
// person's entries. The forget anonymization leaves emailVerified untouched,
// so the live row stays a reliable source; only the email needs the pre-tx
// copy because the user hook has already rewritten it by now.
async function resolveVerifiedUserEmail(ctx: UserDataHookCtx): Promise<string | null> {
  const row = await ctx.db.fetchOne<{ email: string; emailVerified: boolean }>(userTable, {
    id: ctx.userId,
  });
  if (row?.emailVerified !== true) return null;
  if (ctx.userEmailBeforeDelete) return normalizeEmail(ctx.userEmailBeforeDelete);
  return normalizeEmail(await decryptStoredPii(row.email, "email", PII_DECRYPT_REASON));
}

// Entries are decrypted by the executor's list (subject-encrypted name/email/message).
async function findEntriesByEmail(ctx: UserDataHookCtx, email: string) {
  const found = await waitlistExecutor.list(
    { filter: { field: "email", op: "eq", value: email }, limit: ENTRY_LOOKUP_LIMIT },
    platformActor(),
    ctx.db,
  );
  return found.rows;
}

export const waitlistEntryExportHook: UserDataExportHook = async (ctx) => {
  const email = await resolveVerifiedUserEmail(ctx);
  // skip: unverified or missing email must not be matched against waitlist entries
  if (!email) return null;
  const rows = await findEntriesByEmail(ctx, email);
  if (rows.length === 0) return null;
  return {
    entity: "waitlistEntry",
    rows: rows.map((row) => ({
      name: row["name"],
      email: row["email"],
      company: row["company"],
      portfolio: row["portfolio"],
      message: row["message"],
      locale: row["locale"],
      status: row["status"],
      submittedAt: String(row["submittedAt"] ?? ""),
    })),
  };
};

// Waitlist entries carry no retention duty, so both strategies erase: the row
// is purged through the executor (replays on rebuild) and its record subject
// key is shredded so the event log's ciphertext becomes unreadable.
export const waitlistEntryDeleteHook: UserDataDeleteHook = async (ctx) => {
  const email = await resolveVerifiedUserEmail(ctx);
  // skip: unverified or missing email must not be matched against waitlist entries
  if (!email) return;
  const kms = configuredPiiSubjectKms();
  const failures: string[] = [];
  for (const row of await findEntriesByEmail(ctx, email)) {
    const id = row["id"];
    if (typeof id !== "string") continue;
    const forgotten = await waitlistExecutor.forget({ id }, platformActor(), ctx.db);
    collectErasureFailure(forgotten, "waitlistEntry", id, failures);
    if (forgotten.isSuccess && kms) {
      await kms.eraseKey(
        { kind: "record", entity: "waitlistEntry", id },
        { requestId: ERASE_REASON, userId: ctx.userId, eraseReason: ERASE_REASON },
      );
    }
  }
  throwIfErasureFailed(failures);
};
