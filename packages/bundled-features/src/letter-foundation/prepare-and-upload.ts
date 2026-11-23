import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  type UploadedFileBytes,
  uploadFileBytesBeforeTransaction,
} from "@cosmicdrift/kumiko-framework/files";
import type { BeforeTransactionResult } from "@cosmicdrift/kumiko-types/handlers";
import { PDF_MIME_TYPE, sha256Hex } from "../shared/index.ts";
import { LETTER_ENTITY } from "./constants.ts";
import { prepareLetterDocument } from "./document-preparation.ts";
import type { LetterRow } from "./entity.ts";
import type { LetterQuote } from "./types.ts";

export type UploadedLetterDocument = {
  readonly uploaded: UploadedFileBytes;
  readonly pageCount: number;
  readonly sheetCount: number;
  readonly documentSha256: string;
  readonly quote: LetterQuote;
  readonly providerName: string;
};

/** Merges, checks and prices the letter and stores the merged PDF as an upload. Runs before the
 *  transaction: no database connection is held while the provider answers or the file store writes. */
export async function prepareAndUploadLetter(
  ctx: Pick<HandlerContext, "db" | "services" | "registry" | "user">,
  user: SessionUser,
  letter: LetterRow,
): Promise<BeforeTransactionResult<UploadedLetterDocument>> {
  const prepared = await prepareLetterDocument(ctx, user, letter);
  if (!prepared.isSuccess) return prepared;
  const { merged, pageCount, sheetCount, quote, providerName } = prepared.data;
  const uploaded = await uploadFileBytesBeforeTransaction(ctx, {
    // Shown in the letter list's file column, where the full uuid crowded out the neighbouring columns.
    // The tail, because a uuid v7 starts with its timestamp and letters of one batch would share the head.
    fileName: `letter-${letter.id.slice(-8)}.pdf`,
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
}
