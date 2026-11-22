import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { unprocessable } from "../shared/index.ts";
import { LETTER_STATE, LetterErrors, LetterI18n } from "./constants.ts";
import { letterExecutor } from "./entity.ts";
import type { SendLetterInput } from "./payloads.ts";
import { selectLetterProvider } from "./provider-resolver.ts";

export type SendLetterContext = Pick<HandlerContext, "db" | "user" | "registry">;

export type SendLetterResult = {
  readonly letterId: string;
  /** False when the idempotency key already belonged to a letter, which is returned unchanged. */
  readonly created: boolean;
};

async function findLetterByKey(
  ctx: SendLetterContext,
  idempotencyKey: string,
): Promise<string | undefined> {
  const found = await letterExecutor.list(
    { filter: { field: "idempotencyKey", op: "eq", value: idempotencyKey }, limit: 1 },
    ctx.user,
    ctx.db,
  );
  return found.rows[0]?.id;
}

/**
 * Creates a letter that waits for approval; nothing leaves the system before a person with the
 * approve right releases it. Runs in the caller's transaction, so the letter exists exactly when
 * the caller's own change commits. The same idempotency key returns the same letter.
 */
export async function sendLetter(
  ctx: SendLetterContext,
  input: SendLetterInput,
): Promise<WriteResult<SendLetterResult>> {
  if (input.formRequirement === "schriftform" && input.formRiskAcknowledged !== true) {
    return unprocessable(LetterErrors.schriftformRejected, LetterI18n.schriftformRejected);
  }
  const { plugin } = selectLetterProvider(ctx.registry);
  if (!plugin.capabilities.shippingModes.includes(input.shippingMode)) {
    return unprocessable(LetterErrors.shippingModeUnsupported, LetterI18n.shippingModeUnsupported, {
      shippingMode: input.shippingMode,
    });
  }

  const envelope = input.envelope ?? "folded";
  if (!plugin.capabilities.envelopes.includes(envelope)) {
    return unprocessable(LetterErrors.envelopeUnsupported, LetterI18n.envelopeUnsupported, {
      envelope,
    });
  }

  const known = await findLetterByKey(ctx, input.idempotencyKey);
  if (known !== undefined) return { isSuccess: true, data: { letterId: known, created: false } };

  const recipient = input.expectedRecipient;
  const created = await letterExecutor.create(
    {
      status: LETTER_STATE.awaitingApproval,
      idempotencyKey: input.idempotencyKey,
      sourceEntityType: input.source.entityType,
      sourceEntityId: input.source.entityId,
      createdBy: ctx.user.id,
      fileRefIds: input.fileRefIds,
      shippingMode: input.shippingMode,
      envelope,
      color: input.color,
      duplex: input.duplex,
      formRequirement: input.formRequirement,
      formRiskAcknowledged: input.formRiskAcknowledged ?? false,
      recipientName: recipient.name,
      recipientStreet: recipient.street,
      recipientHouseNumber: recipient.houseNumber,
      recipientPostalCode: recipient.postalCode,
      recipientCity: recipient.city,
      ...(recipient.addressExtra !== undefined && {
        recipientAddressExtra: recipient.addressExtra,
      }),
      ...(input.costCenterRef !== undefined && { costCenterRef: input.costCenterRef }),
      ...(input.latestReceiptDate !== undefined && {
        latestReceiptDate: Temporal.PlainDate.from(input.latestReceiptDate),
      }),
    },
    ctx.user,
    ctx.db,
  );
  if (!created.isSuccess) {
    // A parallel call with the same key committed between the lookup and the insert.
    if (propertyOf(created.error, "code") === "unique_violation") {
      const winner = await findLetterByKey(ctx, input.idempotencyKey);
      if (winner !== undefined)
        return { isSuccess: true, data: { letterId: winner, created: false } };
    }
    return created;
  }
  return { isSuccess: true, data: { letterId: String(created.data.id), created: true } };
}
