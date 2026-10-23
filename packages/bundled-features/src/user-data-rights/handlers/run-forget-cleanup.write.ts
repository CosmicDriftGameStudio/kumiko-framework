// POST /userDataRights/run-forget-cleanup.
//
// Cron trigger for the forget-cleanup pipeline. The handler only wraps
// `runForgetCleanup` so the dispatcher can invoke it as the system user;
// the pipeline logic itself lives in the pure-function module
// `run-forget-cleanup.ts`, which can be tested without the dispatcher.
//
// Access: privileged — only system callers (cron, ops script). In the cron
// setup, the job runs with `createSystemUser(...)` as executor.
//
// Returns stats for operator monitoring (processed count, error list).

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import * as z from "zod";
import { resolveAppTenantModel } from "../lib/resolve-tenant-model.ts";
import { makeTenantStorageProviderResolver } from "../lib/storage-provider-resolver.ts";
import {
  FORGET_CLEANUP_HANDLER_NAME,
  runForgetCleanup,
  type SendDeletionExecutedEmailFn,
} from "../run-forget-cleanup.ts";

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
    // Cascades into per-user forget hooks that hard-purge (executor.forget)
    // records without softDelete — an agent must never be able to trigger it.
    agent: { expose: false, risk: "high" },
    escapeHatch: {
      grants: ["unsafeRaw"],
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
      const runner = ctx.db.unsafeRaw();
      // Operator-triggered forget must also erase binaries, not just rows —
      // it flips users to Deleted, after which the cron never re-processes
      // them, so a row-only delete here would permanently leak the binaries.
      // Resolve through the same file-foundation path the cron uses.
      const forgetDb = runner as DbConnection; // @cast-boundary db-runner — DbRunner narrows to DbConnection, config reads tolerate the outer tx
      const tenantModel = await resolveAppTenantModel({
        registry: ctx.registry,
        configResolver: ctx.configResolver,
        db: forgetDb,
        userId: ctx.user.id,
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
          userId: ctx.user.id,
          handlerName: FORGET_CLEANUP_HANDLER_NAME,
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
