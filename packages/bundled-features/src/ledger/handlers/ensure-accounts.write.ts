import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { accountExecutor, accountTable } from "../executor.ts";
import { ensureAccountsPayloadSchema } from "../schemas.ts";
import { DEFAULT_LEDGER_ACCESS } from "../web/constants.ts";

// pg_advisory_xact_lock namespace (int4): 'lena' as ASCII, disjoint from the other ledger lock keys.
const ENSURE_ACCOUNTS_LOCK_NAMESPACE = 0x6c656e61;

export function createEnsureAccountsHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): WriteHandlerDef {
  return {
    name: "ensure-accounts",
    schema: ensureAccountsPayloadSchema,
    access,
    description:
      "Creates the chart-of-accounts entries named by code that do not exist yet and returns the id for every requested code, failing with a conflict when an existing code has a different type; use it to set up an app's fixed accounts idempotently instead of listing and creating them one by one.",
    handler: async (event, ctx) => {
      const payload = ensureAccountsPayloadSchema.parse(event.payload);

      // Fixed lock order across callers prevents deadlocks on overlapping code sets.
      const requested = [...payload.accounts].sort((a, b) => a.code.localeCompare(b.code));
      const ids: Record<string, string> = {};
      const missing: typeof requested = [];
      for (const account of requested) {
        await ctx.db.advisoryXactLock(ENSURE_ACCOUNTS_LOCK_NAMESPACE, account.code);
        const [existing] = await ctx.db.selectMany(
          accountTable,
          { tenantId: event.user.tenantId, code: account.code },
          { limit: 1 },
        );
        if (existing === undefined) {
          missing.push(account);
        } else if (existing["type"] !== account.type) {
          return writeFailure(
            new ConflictError({
              message: "account_type_mismatch",
              details: {
                code: account.code,
                existingType: existing["type"],
                requestedType: account.type,
              },
            }),
          );
        } else {
          ids[account.code] = String(existing["id"]);
        }
      }

      for (const account of missing) {
        const created = await accountExecutor.create(
          { id: generateId(), name: account.name, type: account.type, code: account.code },
          event.user,
          ctx.db,
        );
        if (!created.isSuccess) return created;
        ids[account.code] = String(created.data.id);
      }
      return { isSuccess: true, data: { accounts: ids } };
    },
  };
}
