import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";
import { fetchOne, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";

// POST /api/user/lift-restriction (S2.U6) — DSGVO Art. 18 Reverse.
//
// **Wichtige Eigenheit:** Der User kann diesen Endpoint NICHT selber
// aufrufen weil sein Login geblockt ist (Restricted-Status, siehe
// login.write.ts Atom 3). Wer ein Restricted-Konto wieder aktiviert,
// muss dafuer einen anderen Pfad nutzen — typisch Operator-Tool oder
// Email-Magic-Link an die User-Email. App-Author entscheidet das per
// access-Konfig oder Custom-Wrapper.
//
// MVP-Default: openToAll mit Self-Service-Semantik. Die Asymmetrie
// (User koennte sich selbst freischalten WENN er einen Weg ohne Login
// hat — z.B. valid Magic-Link aus pre-Restriction) ist akzeptabel:
// Restriction ist *Verarbeitungs-Pause*, nicht *Sperre durch Operator*.
// User der "ich will doch wieder mitmachen" sagt, soll das koennen.
//
// State-Transitions:
//   Restricted → Active        ✓
//   Active → ...               ✗ 422 not_restricted (Idempotenz-Guard)
//   DeletionRequested → ...    ✗ 422 not_restricted
//   Deleted → ...              ✗ 422 not_restricted
export const liftRestrictionWrite = defineWriteHandler({
  name: "lift-restriction",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const userRow = await fetchOne<{ status: string }>(ctx.db.raw, userTable, { id: event.user.id });

    if (!userRow) {
      return writeFailure(
        new UnprocessableError("user_not_found", {
          details: { reason: "user_not_found", userId: event.user.id },
        }),
      );
    }

    const currentStatus = userRow["status"];
    if (currentStatus !== USER_STATUS.Restricted) {
      return writeFailure(
        new UnprocessableError("not_restricted", {
          details: { reason: "not_restricted", currentStatus },
        }),
      );
    }

    await updateMany(ctx.db.raw, userTable, { status: USER_STATUS.Active }, { id: event.user.id });

    return {
      isSuccess: true as const,
      data: {
        userId: event.user.id,
        status: USER_STATUS.Active,
      },
    };
  },
});
