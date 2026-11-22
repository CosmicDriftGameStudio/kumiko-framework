import { createEntityExecutor, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import type { ConfigKeyHandle } from "@cosmicdrift/kumiko-types/config";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { capCounterEntity, currentCalendarMonthStartIso } from "../../cap-counter/index.ts";
import { LETTER_CAP, LETTER_ENTITY, LETTER_ROLES, LETTER_STATE, LetterI18n } from "../constants.ts";
import { prepareLetterDocument } from "../document-preparation.ts";
import { letterExecutor } from "../entity.ts";
import { LetterIdSchema } from "../payloads.ts";
import type { LetterMoney } from "../types.ts";

const { table: capCounterTable } = createEntityExecutor(capCounterEntity);

export type LetterPreview = {
  readonly unitNet: LetterMoney;
  readonly totalNet: LetterMoney;
  readonly quantity: 1;
  readonly pageCount: number;
  readonly sheetCount: number;
  readonly limitCents: number;
  readonly usedCents: number;
  readonly fitsLimit: boolean;
  /** i18n key of the hint shown when the monthly limit does not cover the letter. */
  readonly hint?: string;
};

export function createPreviewQuery(limitKey: ConfigKeyHandle<"number">) {
  return defineQueryHandler({
    name: "preview",
    schema: LetterIdSchema,
    access: { roles: [LETTER_ROLES.approver] },
    description:
      "Shows the price of a letter before it is approved, with the unit price, the total net and a hint when the tenant's monthly cost limit does not cover it.",
    handler: async (query, ctx): Promise<LetterPreview> => {
      const letter = await letterExecutor.detail(
        { id: query.payload.letterId },
        query.user,
        ctx.db,
      );
      if (letter === null) throw new NotFoundError(LETTER_ENTITY, query.payload.letterId);

      let unitNet: LetterMoney;
      let pageCount: number;
      let sheetCount: number;
      const { quotedNet } = letter;
      if (
        letter.status !== LETTER_STATE.awaitingApproval &&
        quotedNet &&
        letter.pageCount &&
        letter.sheetCount
      ) {
        unitNet = quotedNet;
        ({ pageCount, sheetCount } = letter);
      } else {
        const prepared = await prepareLetterDocument(ctx, query.user, letter);
        if (!prepared.isSuccess) throw prepared.error;
        unitNet = prepared.data.quote.net;
        ({ pageCount, sheetCount } = prepared.data);
      }

      const limitCents = (await ctx.config?.(limitKey)) ?? 0;
      const periodStart = currentCalendarMonthStartIso(
        Temporal.Instant.from(ctx.tz.now().toString()),
      );
      const [counter] = await ctx.db.selectMany(
        capCounterTable,
        { capName: LETTER_CAP.costNetCents, periodStart },
        { limit: 1 },
      );
      const usedCents = Number(counter?.["value"] ?? 0);
      const fitsLimit = usedCents + unitNet.amount <= limitCents;
      return {
        unitNet,
        totalNet: unitNet,
        quantity: 1,
        pageCount,
        sheetCount,
        limitCents,
        usedCents,
        fitsLimit,
        ...(!fitsLimit && { hint: LetterI18n.limitHint }),
      };
    },
  });
}
