import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { createFileRefFromUploadedBytes } from "@cosmicdrift/kumiko-framework/files";
import type { ConfigKeyHandle } from "@cosmicdrift/kumiko-types/config";
import type { BeforeTransactionResult } from "@cosmicdrift/kumiko-types/handlers";
import { LETTER_STATE, LetterErrors } from "../constants.ts";
import { documentIssueOf, type LetterDocumentIssue } from "../document-preparation.ts";
import { letterExecutor } from "../entity.ts";
import { readLetterBudget } from "../letter-usage.ts";
import { LetterIdSchema } from "../payloads.ts";
import { prepareAndUploadLetter, type UploadedLetterDocument } from "../prepare-and-upload.ts";
import { isLetterPrepared } from "../row-guards.ts";
import { transitionLetter } from "../transitions.ts";
import { APPLIED, internalAccess, NOT_APPLIED } from "./internal-shared.ts";

type PreparePrepared =
  | { readonly kind: "nothing-to-do" }
  | { readonly kind: "document-issue"; readonly issue: LetterDocumentIssue }
  | ({ readonly kind: "uploaded" } & UploadedLetterDocument);

export function createPrepareHandler(limitKey: ConfigKeyHandle<"number">) {
  return defineWriteHandler({
    name: "prepare",
    schema: LetterIdSchema,
    access: internalAccess,
    agent: { expose: false },
    beforeTransactionWhenNested: "skip",
    description:
      "Internal: prepares a waiting letter before anyone approves it (merged PDF, page and sheet count, price) so the letter can be previewed and priced; a fault of the document is stored as the preparation issue. Approves the letter right away when it was sent with automatic approval and the monthly limit covers it.",
    beforeTransaction: async (event, ctx): Promise<BeforeTransactionResult<PreparePrepared>> => {
      const letter = await letterExecutor.detail(
        { id: event.payload.letterId },
        event.user,
        ctx.db,
      );
      if (
        letter === null ||
        letter.status !== LETTER_STATE.awaitingApproval ||
        isLetterPrepared(letter)
      ) {
        return { isSuccess: true, data: { kind: "nothing-to-do" } };
      }
      const uploaded = await prepareAndUploadLetter(ctx, event.user, letter);
      if (uploaded.isSuccess) return { ...uploaded, data: { kind: "uploaded", ...uploaded.data } };
      // Anything but a fault of the document stays an error so the job repeats.
      const issue = documentIssueOf(uploaded.error);
      if (issue === undefined) return uploaded;
      return { isSuccess: true, data: { kind: "document-issue", issue } };
    },
    handler: async (event, ctx) => {
      const { prepared } = event;
      if (prepared === undefined || prepared.kind === "nothing-to-do") return NOT_APPLIED;

      const letter = await letterExecutor.detail(
        { id: event.payload.letterId },
        event.user,
        ctx.db,
      );
      if (
        letter === null ||
        letter.status !== LETTER_STATE.awaitingApproval ||
        isLetterPrepared(letter)
      ) {
        return NOT_APPLIED;
      }
      const stillWaiting = {
        skipOptimisticLock: true,
        expect: { status: LETTER_STATE.awaitingApproval },
      };

      if (prepared.kind === "document-issue") {
        const stored = await letterExecutor.update(
          { id: letter.id, changes: { preparationIssue: prepared.issue } },
          event.user,
          ctx.db,
          stillWaiting,
        );
        return stored.isSuccess ? APPLIED : stored;
      }

      const fileRef = await createFileRefFromUploadedBytes(ctx, prepared.uploaded);
      if (!fileRef.isSuccess) return fileRef;
      const price = prepared.quote.net;
      const changes = {
        mergedFileRefId: String(fileRef.data.id),
        documentSha256: prepared.documentSha256,
        pageCount: prepared.pageCount,
        sheetCount: prepared.sheetCount,
        quotedNet: price,
        priceSource: prepared.quote.priceSource,
        providerName: prepared.providerName,
      };

      let preparationIssue: string | null = null;
      if (letter.approvalMode === "auto") {
        const { limitCents, usedCents } = await readLetterBudget(ctx, limitKey, letter.id);
        if (usedCents + price.amount <= limitCents) {
          const approved = await transitionLetter(ctx, event.user, {
            letterId: letter.id,
            from: LETTER_STATE.awaitingApproval,
            to: LETTER_STATE.approved,
            changes: { ...changes, approvedBy: letter.createdBy },
          });
          return approved.isSuccess ? APPLIED : approved;
        }
        preparationIssue = LetterErrors.monthlyLimitNotCovered;
      }
      const stored = await letterExecutor.update(
        { id: letter.id, changes: { ...changes, preparationIssue } },
        event.user,
        ctx.db,
        stillWaiting,
      );
      return stored.isSuccess ? APPLIED : stored;
    },
  });
}
