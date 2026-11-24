import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { unprocessable } from "../shared/index.ts";
import {
  LETTER_STATE,
  type LetterApprovalMode,
  LetterErrors,
  LetterI18n,
  LetterInternalHandlers,
} from "./constants.ts";
import { letterExecutor } from "./entity.ts";
import type { SendLetterInput } from "./payloads.ts";
import { selectLetterProviderOrFailure } from "./provider-resolver.ts";
import type { LetterEnvelope, LetterProviderCapabilities } from "./types.ts";

export type SendLetterContext = Pick<
  HandlerContext,
  "db" | "user" | "registry" | "dispatch" | "config"
>;

export type SendLetterOptions = { readonly approval?: LetterApprovalMode };

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

function refusedByProvider(
  capabilities: LetterProviderCapabilities,
  input: SendLetterInput,
  envelope: LetterEnvelope,
): WriteResult<never> | undefined {
  if (!capabilities.shippingModes.includes(input.shippingMode)) {
    return unprocessable(LetterErrors.shippingModeUnsupported, LetterI18n.shippingModeUnsupported, {
      shippingMode: input.shippingMode,
    });
  }
  if (!capabilities.envelopes.includes(envelope)) {
    return unprocessable(LetterErrors.envelopeUnsupported, LetterI18n.envelopeUnsupported, {
      envelope,
    });
  }
  return undefined;
}

function newLetterOf(
  createdBy: string,
  input: SendLetterInput,
  envelope: LetterEnvelope,
  approval: LetterApprovalMode,
): Parameters<typeof letterExecutor.create>[0] {
  const recipient = input.expectedRecipient;
  return {
    status: LETTER_STATE.awaitingApproval,
    approvalMode: approval,
    idempotencyKey: input.idempotencyKey,
    sourceEntityType: input.source.entityType,
    sourceEntityId: input.source.entityId,
    createdBy,
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
    ...(recipient.addressExtra !== undefined && { recipientAddressExtra: recipient.addressExtra }),
    ...(input.costCenterRef !== undefined && { costCenterRef: input.costCenterRef }),
    ...(input.latestReceiptDate !== undefined && {
      latestReceiptDate: Temporal.PlainDate.from(input.latestReceiptDate),
    }),
  };
}

/**
 * Creates a letter that waits for approval. It is released by a person with the approve right,
 * or, with `options.approval: "auto"`, by the preparation job once the letter is prepared and the
 * monthly limit covers it; nothing is handed over before one of the two. `approval` is a server-side
 * decision of the app and deliberately not part of `SendLetterInput`, which apps use as a client payload.
 * Runs in the caller's transaction, so the letter exists exactly when
 * the caller's own change commits. The same idempotency key returns the same letter.
 */
export async function sendLetter(
  ctx: SendLetterContext,
  input: SendLetterInput,
  options: SendLetterOptions = {},
): Promise<WriteResult<SendLetterResult>> {
  if (input.formRequirement === "schriftform" && input.formRiskAcknowledged !== true) {
    return unprocessable(LetterErrors.schriftformRejected, LetterI18n.schriftformRejected);
  }
  const selected = await selectLetterProviderOrFailure(ctx);
  if (!selected.isSuccess) return selected;
  const envelope = input.envelope ?? "folded";
  const unsupported = refusedByProvider(selected.data.plugin.capabilities, input, envelope);
  if (unsupported !== undefined) return unsupported;

  const known = await findLetterByKey(ctx, input.idempotencyKey);
  if (known !== undefined) return { isSuccess: true, data: { letterId: known, created: false } };

  const created = await letterExecutor.create(
    newLetterOf(ctx.user.id, input, envelope, options.approval ?? "manual"),
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
  const letterId = String(created.data.id);
  const announced = await ctx.dispatch.write(LetterInternalHandlers.announceCreated, { letterId });
  if (!announced.isSuccess) return announced;
  return { isSuccess: true, data: { letterId, created: true } };
}
