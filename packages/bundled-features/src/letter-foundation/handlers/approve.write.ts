import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { createFileRefFromUploadedBytes } from "@cosmicdrift/kumiko-framework/files";
import type { ConfigKeyHandle } from "@cosmicdrift/kumiko-types/config";
import type { BeforeTransactionResult } from "@cosmicdrift/kumiko-types/handlers";
import { unprocessable } from "../../shared/index.ts";
import {
  LETTER_ENTITY,
  LETTER_ROLES,
  LETTER_STATE,
  LetterErrors,
  LetterI18n,
} from "../constants.ts";
import { letterExecutor } from "../entity.ts";
import { monthlyLimitFailure, readLetterBudget } from "../letter-usage.ts";
import { LetterIdSchema } from "../payloads.ts";
import { prepareAndUploadLetter, type UploadedLetterDocument } from "../prepare-and-upload.ts";
import { isLetterPrepared } from "../row-guards.ts";
import { transitionLetter } from "../transitions.ts";

type ApprovePrepared =
  | { readonly kind: "already-prepared" }
  | ({ readonly kind: "upload" } & UploadedLetterDocument);

export function createApproveHandler(limitKey: ConfigKeyHandle<"number">) {
  return defineWriteHandler({
    name: "approve",
    schema: LetterIdSchema,
    access: { roles: [LETTER_ROLES.approver] },
    agent: { effect: "outbound" },
    beforeTransactionWhenNested: "skip",
    description:
      "Approves a letter that waits for approval: releases it for handover to the print provider at the price fixed in its preparation. A letter that is not prepared yet is merged into one PDF, checked against the provider's limits and priced first.",
    // A prepared letter needs no work here. Otherwise the PDF work and the quote run before the
    // transaction, so no database connection is held while the provider answers or the file store writes.
    beforeTransaction: async (event, ctx): Promise<BeforeTransactionResult<ApprovePrepared>> => {
      const letter = await letterExecutor.detail(
        { id: event.payload.letterId },
        event.user,
        ctx.db,
      );
      if (letter === null) return failNotFound(LETTER_ENTITY, event.payload.letterId);
      if (letter.status !== LETTER_STATE.awaitingApproval) {
        return unprocessable(LetterErrors.notAwaitingApproval, LetterI18n.notAwaitingApproval);
      }
      if (isLetterPrepared(letter)) return { isSuccess: true, data: { kind: "already-prepared" } };
      const uploaded = await prepareAndUploadLetter(ctx, event.user, letter);
      if (!uploaded.isSuccess) return uploaded;
      return { ...uploaded, data: { kind: "upload", ...uploaded.data } };
    },
    handler: async (event, ctx) => {
      const { prepared } = event;
      // Read again: the preparation job may have stored its result since beforeTransaction looked, and
      // writing this run's own upload then would replace the stored file with a second copy.
      const letter = await letterExecutor.detail(
        { id: event.payload.letterId },
        event.user,
        ctx.db,
      );
      if (letter === null) return failNotFound(LETTER_ENTITY, event.payload.letterId);
      const { quotedNet } = letter;
      const storedPrice = isLetterPrepared(letter) && quotedNet ? quotedNet : undefined;

      if (storedPrice === undefined && prepared?.kind === "upload") {
        const limitFailure = monthlyLimitFailure(
          await readLetterBudget(ctx, limitKey),
          prepared.quote.net.amount,
        );
        if (limitFailure !== undefined) return limitFailure;
        const fileRef = await createFileRefFromUploadedBytes(ctx, prepared.uploaded);
        if (!fileRef.isSuccess) return fileRef;
        return transitionLetter(ctx, event.user, {
          letterId: event.payload.letterId,
          from: LETTER_STATE.awaitingApproval,
          to: LETTER_STATE.approved,
          changes: {
            mergedFileRefId: String(fileRef.data.id),
            documentSha256: prepared.documentSha256,
            pageCount: prepared.pageCount,
            sheetCount: prepared.sheetCount,
            quotedNet: prepared.quote.net,
            priceSource: prepared.quote.priceSource,
            providerName: prepared.providerName,
            approvedBy: event.user.id,
            preparationIssue: null,
          },
        });
      }

      // Nested runs skip beforeTransaction, and a letter prepared in the meantime needs no upload either.
      if (letter.status !== LETTER_STATE.awaitingApproval || storedPrice === undefined) {
        return unprocessable(LetterErrors.stateChanged, LetterI18n.stateChanged);
      }
      const limitFailure = monthlyLimitFailure(
        await readLetterBudget(ctx, limitKey),
        storedPrice.amount,
      );
      if (limitFailure !== undefined) return limitFailure;
      return transitionLetter(ctx, event.user, {
        letterId: event.payload.letterId,
        from: LETTER_STATE.awaitingApproval,
        to: LETTER_STATE.approved,
        changes: { approvedBy: event.user.id, preparationIssue: null },
      });
    },
  });
}
