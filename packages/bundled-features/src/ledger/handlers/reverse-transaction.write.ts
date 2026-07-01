import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { DEFAULT_LEDGER_ACCESS } from "../constants";
import { transactionExecutor, transactionTable } from "../executor";
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

      // Only a posted entry contributes to the books (rawBalances skips
      // anything else) — reversing a draft would book a real, balanced
      // Storno entry against a booking that was never counted, creating a
      // phantom balance with no corresponding original.
      if (original["status"] !== "posted") {
        return writeFailure(
          new UnprocessableError("only posted transactions can be reversed", {
            details: { transactionId: payload.id, status: original["status"] },
          }),
        );
      }

      // Dedup guard: two reverse() calls on the same original would each book
      // an independently-balanced Storno (the global trial balance stays 0
      // either way, masking the bug), doubling the per-account effect. The
      // reference column ties a Storno back to its original 1:1.
      const alreadyReversed = await selectMany(ctx.db.raw, transactionTable, {
        tenantId: event.user.tenantId,
        reference: payload.id,
      });
      if (alreadyReversed.length > 0) {
        return writeFailure(
          new ConflictError({
            message: "transaction already reversed",
            details: { transactionId: payload.id },
          }),
        );
      }

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
