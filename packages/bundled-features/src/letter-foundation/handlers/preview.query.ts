import { createEntityExecutor, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, reraiseAsKumikoError } from "@cosmicdrift/kumiko-framework/errors";
import type { ConfigKeyHandle } from "@cosmicdrift/kumiko-types/config";
import { capCounterEntity, currentCalendarMonthStartIso } from "../../cap-counter/index.ts";
import { LETTER_CAP, LETTER_ENTITY, LETTER_ROLES, LETTER_STATE, LetterI18n } from "../constants.ts";
import { prepareLetterDocument } from "../document-preparation.ts";
import { letterExecutor } from "../entity.ts";
import { LetterIdSchema } from "../payloads.ts";
import { resolveLetterProviderOrFailure } from "../provider-resolver.ts";
import { envelopeOf, isLetterFormRequirement } from "../row-guards.ts";
import type { LetterEnvelope, LetterFormRequirement, LetterMoney } from "../types.ts";

const { table: capCounterTable } = createEntityExecutor(capCounterEntity);

export type LetterPreview = {
  readonly unitNet: LetterMoney;
  readonly totalNet: LetterMoney;
  readonly quantity: 1;
  readonly pageCount: number;
  readonly sheetCount: number;
  readonly envelope: LetterEnvelope;
  /** True when the envelope is `flat` but the letter has more sheets than the provider honors it for: the provider picks the envelope. */
  readonly envelopeLeftToProvider: boolean;
  /** The app shows the form risk before approval when this is `schriftform` and the risk was acknowledged at send time. */
  readonly formRequirement: LetterFormRequirement;
  readonly formRiskAcknowledged: boolean;
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
    rateLimit: { per: "user+handler", limit: 30, windowSeconds: 60 },
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
        if (!prepared.isSuccess) throw reraiseAsKumikoError(prepared.error);
        unitNet = prepared.data.quote.net;
        ({ pageCount, sheetCount } = prepared.data);
      }

      const envelope = envelopeOf(letter);
      const resolved = await resolveLetterProviderOrFailure(ctx.registry);
      if (!resolved.isSuccess) throw reraiseAsKumikoError(resolved.error);
      const { maxFlatSheets } = resolved.data.capabilities;
      const limitCents = (await ctx.config?.(limitKey)) ?? 0;
      const periodStart = currentCalendarMonthStartIso(ctx.tz.now());
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
        envelope,
        envelopeLeftToProvider:
          envelope === "flat" && maxFlatSheets !== undefined && sheetCount > maxFlatSheets,
        // An unreadable value shows as the strictest form, so the approver sees the warning rather than nothing.
        formRequirement: isLetterFormRequirement(letter.formRequirement)
          ? letter.formRequirement
          : "schriftform",
        formRiskAcknowledged: letter.formRiskAcknowledged === true,
        limitCents,
        usedCents,
        fitsLimit,
        ...(!fitsLimit && { hint: LetterI18n.limitHint }),
      };
    },
  });
}
