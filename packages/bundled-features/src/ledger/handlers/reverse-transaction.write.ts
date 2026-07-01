import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { DEFAULT_LEDGER_ACCESS } from "../constants";
import { transactionExecutor } from "../executor";
import { normalizeLines } from "../reports";
import { type ReverseTransactionPayload, reverseTransactionPayloadSchema } from "../schemas";

// reverse-transaction (Storno) — the ONLY correction path for a posted entry.
// Books the mirror image (every amount negated) as a new posted entry that
// references the original, leaving the original untouched. This is why
// transactions need no update/delete: the audit trail stays intact and the
// mirror entry still satisfies Σ=0 (negating a zero-sum set stays zero-sum).
export function createReverseTransactionHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): WriteHandlerDef {
  return {
    name: "reverse-transaction",
    schema: reverseTransactionPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as ReverseTransactionPayload; // @cast-boundary engine-payload

      const original = await transactionExecutor.detail({ id: payload.id }, event.user, ctx.db);
      if (!original) return writeFailure(new NotFoundError("transaction", payload.id));

      // jsonb `lines` may surface as a parsed array or a JSON string depending
      // on the driver path — normalizeLines handles both (see reports.ts).
      const lines = normalizeLines(original["lines"]).map((l) => ({
        accountId: l.accountId,
        amount: -l.amount,
      }));

      return transactionExecutor.create(
        {
          id: generateId(),
          // Pass the original's date through untyped — create takes Record<string,
          // unknown>, so no guess at the projection's date runtime type.
          date: payload.date ?? original["date"],
          description: payload.description ?? `Storno: ${String(original["description"])}`,
          reference: payload.id,
          status: "posted",
          lines,
        },
        event.user,
        ctx.db,
      );
    },
  };
}

export const reverseTransactionHandler: WriteHandlerDef = createReverseTransactionHandler();
