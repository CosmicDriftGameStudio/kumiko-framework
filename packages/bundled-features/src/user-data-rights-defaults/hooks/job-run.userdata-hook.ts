import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { jobRunsTable } from "../../jobs";
import { featureMounted } from "./feature-mounted";

// userData-Hooks for the jobs run log (deferred from #797, closed by #799).
// Job runs live on the SYSTEM tenant regardless of who triggered them, so
// the export filters by triggeredById only — Art. 15 covers everything the
// user caused, across tenants. payload may be ciphertext (kumiko-pii:); the
// export runner's central decrypt sweep resolves it.

export const jobRunExportHook: UserDataExportHook = async (ctx) => {
  if (!featureMounted(ctx, "jobs")) return null;
  const rows = await selectMany<Record<string, unknown>>(ctx.db, jobRunsTable, {
    triggeredById: ctx.userId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "job-run",
    rows: rows.map((r) => ({
      jobName: r["jobName"],
      status: r["status"],
      payload: r["payload"],
      startedAt: r["startedAt"],
      finishedAt: r["finishedAt"],
    })),
  };
};

export const jobRunDeleteHook: UserDataDeleteHook = async () => {
  // Deliberate no-op: erasure runs via crypto-shredding — the forget pipeline
  // erases the triggering user's DEK, which makes the payload unreadable in
  // BOTH the append-only events and the projected rows (#799). triggeredById
  // itself is a pseudonymous fk (plaintext by design, like config.userId).
};
