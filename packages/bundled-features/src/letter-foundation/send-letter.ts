import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
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

/**
 * Creates a letter that waits for approval; nothing leaves the system before a person with the
 * approve right releases it. Runs in the caller's transaction, so the letter exists exactly when
 * the caller's own change commits. The same idempotency key returns the same letter.
 */
export async function sendLetter(
  ctx: SendLetterContext,
  input: SendLetterInput,
): Promise<WriteResult<SendLetterResult>> {
  if (input.formRequirement === "schriftform") {
    return unprocessable(LetterErrors.schriftformRejected, LetterI18n.schriftformRejected);
  }
  const { plugin } = selectLetterProvider(ctx.registry);
  if (!plugin.capabilities.shippingModes.includes(input.shippingMode)) {
    return unprocessable(LetterErrors.shippingModeUnsupported, LetterI18n.shippingModeUnsupported, {
      shippingMode: input.shippingMode,
    });
  }

  const existing = await letterExecutor.list(
    { filter: { field: "idempotencyKey", op: "eq", value: input.idempotencyKey }, limit: 1 },
    ctx.user,
    ctx.db,
  );
  const known = existing.rows[0];
  if (known !== undefined) return { isSuccess: true, data: { letterId: known.id, created: false } };

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
      color: input.color,
      duplex: input.duplex,
      formRequirement: input.formRequirement,
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
  if (!created.isSuccess) return created;
  return { isSuccess: true, data: { letterId: String(created.data.id), created: true } };
}
