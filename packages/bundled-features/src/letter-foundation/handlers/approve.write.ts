import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import {
  createFileRefFromUploadedBytes,
  type UploadedFileBytes,
  uploadFileBytesBeforeTransaction,
} from "@cosmicdrift/kumiko-framework/files";
import type { BeforeTransactionResult } from "@cosmicdrift/kumiko-types/handlers";
import { PDF_MIME_TYPE, sha256Hex, unprocessable } from "../../shared/index.ts";
import {
  LETTER_ENTITY,
  LETTER_ROLES,
  LETTER_STATE,
  LetterErrors,
  LetterI18n,
} from "../constants.ts";
import { prepareLetterDocument } from "../document-preparation.ts";
import { letterExecutor } from "../entity.ts";
import { LetterIdSchema } from "../payloads.ts";
import { transitionLetter } from "../transitions.ts";
import type { LetterQuote } from "../types.ts";

type ApprovePrepared = {
  readonly uploaded: UploadedFileBytes;
  readonly pageCount: number;
  readonly sheetCount: number;
  readonly documentSha256: string;
  readonly quote: LetterQuote;
  readonly providerName: string;
};

export const approveHandler = defineWriteHandler({
  name: "approve",
  schema: LetterIdSchema,
  access: { roles: [LETTER_ROLES.approver] },
  agent: { effect: "outbound" },
  beforeTransactionWhenNested: "skip",
  description:
    "Approves a letter that waits for approval: merges its documents into one PDF, checks it against the provider's limits, fixes the preview price and releases the letter for handover to the print provider.",
  // The PDF work and the quote run before the transaction, so no database connection is held
  // while the provider answers or the file store writes.
  beforeTransaction: async (event, ctx): Promise<BeforeTransactionResult<ApprovePrepared>> => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    if (letter === null) return failNotFound(LETTER_ENTITY, event.payload.letterId);
    if (letter.status !== LETTER_STATE.awaitingApproval) {
      return unprocessable(LetterErrors.notAwaitingApproval, LetterI18n.notAwaitingApproval);
    }
    const prepared = await prepareLetterDocument(ctx, event.user, letter);
    if (!prepared.isSuccess) return prepared;
    const { merged, pageCount, sheetCount, quote, providerName } = prepared.data;
    const uploaded = await uploadFileBytesBeforeTransaction(ctx, {
      fileName: `letter-${letter.id}.pdf`,
      mimeType: PDF_MIME_TYPE,
      data: merged,
      attachTo: { entityType: LETTER_ENTITY, fieldName: "mergedFileRefId", entityId: letter.id },
    });
    if (!uploaded.isSuccess) return uploaded;
    return {
      isSuccess: true,
      data: {
        uploaded: uploaded.data,
        pageCount,
        sheetCount,
        documentSha256: sha256Hex(merged),
        quote,
        providerName,
      },
      ...(uploaded.release !== undefined && { release: uploaded.release }),
    };
  },
  handler: async (event, ctx) => {
    const { prepared } = event;
    if (prepared === undefined) {
      return unprocessable(LetterErrors.stateChanged, LetterI18n.stateChanged);
    }
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
      },
    });
  },
});
