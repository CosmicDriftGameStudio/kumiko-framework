import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import type {
  UserDataDeleteHook,
  UserDataExportHook,
  UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { collectErasureFailure, throwIfErasureFailed } from "../shared/index.ts";
import { resolveVerifiedUserEmail } from "../user/index.ts";
import { platformActor, waitlistExecutor } from "./lib.ts";

const PII_DECRYPT_REASON = "waitlist:user-data";
const ERASE_REASON = "waitlist:user-data-forget";
const ENTRY_LOOKUP_LIMIT = 100;

// Entries are decrypted by the executor's list (subject-encrypted name/email/message).
// guard:dup-ok executor and foreign-key field differ; a generic executor abstraction would obscure row types.
async function findEntriesByEmail(ctx: UserDataHookCtx, email: string) {
  const found = await waitlistExecutor.list(
    { filter: { field: "email", op: "eq", value: email }, limit: ENTRY_LOOKUP_LIMIT },
    platformActor(),
    ctx.db,
  );
  return found.rows;
}

export const waitlistEntryExportHook: UserDataExportHook = async (ctx) => {
  const email = await resolveVerifiedUserEmail(ctx, PII_DECRYPT_REASON);
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
  const email = await resolveVerifiedUserEmail(ctx, PII_DECRYPT_REASON);
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
