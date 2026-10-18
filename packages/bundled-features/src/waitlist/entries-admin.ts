import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { collectErasureFailure, throwIfErasureFailed } from "../shared/index.js";
import { platformActor, waitlistExecutor } from "./lib.js";

const PAGE_SIZE = 200;
const PURGE_REASON = "waitlist:purge";

export type WaitlistRow = Record<string, unknown>;

// Pages by offset on a stable sort; the list is small (a marketing waitlist) and
// the callers hold the whole result anyway.
export async function listAllWaitlistRows(db: TenantDb): Promise<readonly WaitlistRow[]> {
  const rows: WaitlistRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await waitlistExecutor.list(
      { sort: "submittedAt", sortDirection: "asc", limit: PAGE_SIZE, offset },
      platformActor(),
      db,
    );
    rows.push(...page.rows);
    if (page.rows.length < PAGE_SIZE) return rows;
  }
}

// Same two-step erasure as the user-data delete hook: the executor forgets the
// row (replays on rebuild), then the record subject key is shredded so the event
// log's ciphertext becomes unreadable. Keys are shredded only after every forget
// succeeded: a thrown failure rolls the handler transaction back, and a shredded
// key cannot be restored.
export async function purgeWaitlistRows(
  db: TenantDb,
  rows: readonly WaitlistRow[],
  requestedBy: string,
): Promise<void> {
  const failures: string[] = [];
  const forgottenIds: string[] = [];
  for (const row of rows) {
    const id = row["id"];
    if (typeof id !== "string") continue;
    const forgotten = await waitlistExecutor.forget({ id }, platformActor(), db);
    collectErasureFailure(forgotten, "waitlistEntry", id, failures);
    if (forgotten.isSuccess) forgottenIds.push(id);
  }
  throwIfErasureFailed(failures);
  const kms = configuredPiiSubjectKms();
  if (!kms) return;
  for (const id of forgottenIds) {
    await kms.eraseKey(
      { kind: "record", entity: "waitlistEntry", id },
      { requestId: PURGE_REASON, userId: requestedBy, eraseReason: PURGE_REASON },
    );
  }
}
