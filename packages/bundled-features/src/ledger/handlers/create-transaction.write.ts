import type {
  AccessRule,
  WriteHandlerDef,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { accountExecutor, transactionExecutor, transactionTable } from "../executor.ts";
import { type CreateTransactionPayload, createTransactionPayloadSchema } from "../schemas.ts";
import { DEFAULT_LEDGER_ACCESS } from "../web/constants.ts";

// pg_advisory_xact_lock namespace, disjoint from the other ledger lock keys.
const CREATE_TRANSACTION_SOURCE_REF_LOCK_NAMESPACE = 0x6c_63_74_78; // 'lctx'

// create-transaction — books a balanced journal entry. The Σ=0 and ≥2-accounts
// invariants are enforced by createTransactionPayloadSchema (command boundary).
// This handler adds referential integrity (every posting's account must exist —
// there is no FK in an event-sourced store) and assigns a fresh id. Entries are
// posted by default and immutable thereafter (no update/delete handler exists).
// An optional sourceRef makes the call idempotent per tenant; the key stays with
// its entry after a reversal, so re-booking after a Storno needs a new key.
export function createCreateTransactionHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): WriteHandlerDef {
  return {
    name: "create-transaction",
    schema: createTransactionPayloadSchema,
    access,
    description:
      "Books one balanced journal entry from a date, description and at least two posting lines summing to zero, after verifying every named account exists; use it to record any financial movement in the tenant's books. With a sourceRef it books at most once per tenant and returns the existing entry with alreadyBooked true on a repeat call.",
    agent: { risk: "high" },
    handler: async (event, ctx) => {
      const payload = event.payload as CreateTransactionPayload; // @cast-boundary engine-payload

      // Lock serializes parallel calls with the same key; the partial unique index is the backstop.
      if (payload.sourceRef !== undefined) {
        await ctx.db.advisoryXactLock(
          CREATE_TRANSACTION_SOURCE_REF_LOCK_NAMESPACE,
          payload.sourceRef,
        );
        const [booked] = await ctx.db.selectMany(transactionTable, {
          tenantId: event.user.tenantId,
          sourceRef: payload.sourceRef,
        });
        if (booked !== undefined) {
          const replay: WriteResult<{ id: string; alreadyBooked: true }> = {
            isSuccess: true,
            data: { id: String(booked["id"]), alreadyBooked: true },
          };
          return replay;
        }
      }

      for (const accountId of new Set(payload.lines.map((l) => l.accountId))) {
        const account = await accountExecutor.detail({ id: accountId }, event.user, ctx.db);
        if (!account) return writeFailure(new NotFoundError("account", accountId));
      }

      const created = await transactionExecutor.create(
        {
          id: generateId(),
          date: payload.date,
          description: payload.description,
          reference: payload.reference ?? null,
          period: payload.period ?? null,
          scheduleId: null,
          reversesTransactionId: null,
          status: payload.status ?? "posted",
          lines: payload.lines,
          subjectType: payload.subjectType ?? null,
          subjectId: payload.subjectId ?? null,
          sourceRef: payload.sourceRef ?? null,
        },
        event.user,
        ctx.db,
      );
      if (!created.isSuccess) return created;
      return { isSuccess: true, data: { ...created.data, alreadyBooked: false as const } };
    },
  };
}

export const createTransactionHandler: WriteHandlerDef = createCreateTransactionHandler();
