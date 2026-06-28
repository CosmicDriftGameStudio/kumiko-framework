import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { DEFAULT_LEDGER_ACCESS } from "../constants";
import { accountExecutor, transactionExecutor } from "../executor";
import { type CreateTransactionPayload, createTransactionPayloadSchema } from "../schemas";

// create-transaction — books a balanced journal entry. The Σ=0 and ≥2-accounts
// invariants are enforced by createTransactionPayloadSchema (command boundary).
// This handler adds referential integrity (every posting's account must exist —
// there is no FK in an event-sourced store) and assigns a fresh id. Entries are
// posted by default and immutable thereafter (no update/delete handler exists).
export function createCreateTransactionHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): WriteHandlerDef {
  return {
    name: "create-transaction",
    schema: createTransactionPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as CreateTransactionPayload; // @cast-boundary engine-payload

      for (const accountId of new Set(payload.lines.map((l) => l.accountId))) {
        const account = await accountExecutor.detail({ id: accountId }, event.user, ctx.db);
        if (!account) return writeFailure(new NotFoundError("account", accountId));
      }

      return transactionExecutor.create(
        {
          id: generateId(),
          date: payload.date,
          description: payload.description,
          reference: payload.reference ?? null,
          status: payload.status ?? "posted",
          lines: payload.lines,
        },
        event.user,
        ctx.db,
      );
    },
  };
}

export const createTransactionHandler: WriteHandlerDef = createCreateTransactionHandler();
