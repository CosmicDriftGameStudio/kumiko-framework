// POST /userDataRights/run-forget-cleanup (S2.U5b).
//
// Cron-Trigger fuer den Forget-Cleanup-Pipeline. Der Handler wrapt nur
// `runForgetCleanup` damit er via dispatcher (System-User) aufrufbar
// wird — die Pipeline-Logik selbst lebt im pure-function Modul
// `run-forget-cleanup.ts` (testbar ohne dispatcher).
//
// Access: privileged — nur System-Caller (cron, ops-script). Im Cron-
// Setup laeuft der Job mit `createSystemUser(...)` als executor.
//
// Rueckgabe: Stats fuer Operator-Monitoring (processed-count, error-list).

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler, SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import * as z from "zod";
import { resolveAppTenantModel } from "../lib/resolve-tenant-model";
import { makeTenantStorageProviderResolver } from "../lib/storage-provider-resolver";
import { runForgetCleanup, type SendDeletionExecutedEmailFn } from "../run-forget-cleanup";

export type RunForgetCleanupOptions = {
  readonly sendDeletionExecutedEmail?: SendDeletionExecutedEmailFn;
};

const RUN_FORGET_CLEANUP_REASON =
  "operator forget cleanup iterates users across tenants in per-user sub-transactions";

export function createRunForgetCleanupHandler(opts: RunForgetCleanupOptions = {}) {
  return defineWriteHandler({
    name: "run-forget-cleanup",
    schema: z.object({}),
    access: { roles: access.privileged },
    agent: { expose: false },
    escapeHatch: {
      reason: RUN_FORGET_CLEANUP_REASON,
    },
    handler: async (_event, ctx) => {
      if (!ctx.registry) {
        return writeFailure(
          new InternalError({
            message: "run-forget-cleanup: ctx.registry missing",
          }),
        );
      }

      const T = getTemporal();
      const runner = ctx.db.unsafeRaw(RUN_FORGET_CLEANUP_REASON);
      // Operator-triggered forget must also erase binaries, not just rows —
      // it flips users to Deleted, after which the cron never re-processes
      // them, so a row-only delete here would permanently leak the binaries.
      // Resolve through the same file-foundation path the cron uses.
      const forgetDb = runner as DbConnection; // @cast-boundary db-runner — DbRunner narrows to DbConnection, config reads tolerate the outer tx
      const tenantModel = await resolveAppTenantModel({
        registry: ctx.registry,
        configResolver: ctx.configResolver,
        db: forgetDb,
        userId: ctx._userId ?? SYSTEM_USER_ID,
      });
      const result = await runForgetCleanup({
        db: runner,
        registry: ctx.registry,
        now: T.Now.instant(),
        tenantModel,
        ...(ctx.searchAdapter !== undefined && { searchAdapter: ctx.searchAdapter }),
        buildStorageProvider: makeTenantStorageProviderResolver({
          registry: ctx.registry,
          configResolver: ctx.configResolver,
          secrets: ctx.secrets,
          db: forgetDb,
          userId: ctx._userId ?? SYSTEM_USER_ID,
          handlerName: "user-data-rights:run-forget-cleanup",
        }),
        ...(opts.sendDeletionExecutedEmail && {
          sendDeletionExecutedEmail: opts.sendDeletionExecutedEmail,
        }),
      });

      return {
        isSuccess: true as const,
        data: {
          processedUserIds: result.processedUserIds,
          hookCallsAttempted: result.hookCallsAttempted,
          errorCount: result.errors.length,
          errors: result.errors,
          incompleteCount: result.incomplete.length,
          incomplete: result.incomplete,
        },
      };
    },
  });
}
