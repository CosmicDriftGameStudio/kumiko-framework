import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { MAX_DOCUMENT_BYTES, readTenantFile } from "../file-foundation/index.ts";
import { checkPostalPdf, mergePdfs, unprocessable } from "../shared/index.ts";
import { LetterErrors, LetterI18n } from "./constants.ts";
import type { LetterRow } from "./entity.ts";
import { resolveLetterProvider } from "./provider-resolver.ts";
import { envelopeOf, isLetterShippingMode, isStringList } from "./row-guards.ts";
import type { LetterQuote } from "./types.ts";

export type PreparedLetterDocument = {
  readonly merged: Uint8Array;
  readonly pageCount: number;
  readonly sheetCount: number;
  readonly quote: LetterQuote;
  readonly providerName: string;
};

export function sheetsFor(pageCount: number, duplex: boolean): number {
  return duplex ? Math.ceil(pageCount / 2) : pageCount;
}

/** Merges the letter's documents, checks them against the provider's limits and asks for the price.
 *  Calls the provider, so it never runs inside an open database transaction. */
export async function prepareLetterDocument(
  ctx: Pick<HandlerContext, "db" | "services" | "registry">,
  user: SessionUser,
  letter: LetterRow,
): Promise<WriteResult<PreparedLetterDocument>> {
  const resolved = await resolveLetterProvider(ctx.registry);
  const { capabilities } = resolved;

  const documents: Uint8Array[] = [];
  const maxBytes = Math.min(capabilities.maxBytes, MAX_DOCUMENT_BYTES);
  let totalBytes = 0;
  const { fileRefIds, shippingMode } = letter;
  if (!isStringList(fileRefIds) || !isLetterShippingMode(shippingMode)) {
    return unprocessable(LetterErrors.documentUnreadable, LetterI18n.documentUnreadable);
  }
  for (const fileRefId of fileRefIds) {
    const file = await readTenantFile(ctx, user.tenantId, fileRefId);
    if (file === null) {
      return unprocessable(LetterErrors.documentUnreadable, LetterI18n.documentUnreadable, {
        fileRefId,
      });
    }
    // Merging does not shrink the parts in practice, so oversized input stops before the remaining files are read and merged.
    totalBytes += file.content.byteLength;
    if (totalBytes > maxBytes) {
      return unprocessable(LetterErrors.documentRejected, LetterI18n.documentRejected, {
        documentReason: "file-too-large",
        page: null,
        detail: `${totalBytes} bytes exceed the limit of ${maxBytes}`,
      });
    }
    documents.push(file.content);
  }
  if (documents.length === 0) return unprocessable(LetterErrors.noFiles, LetterI18n.noFiles);

  let merged: Uint8Array;
  try {
    merged = await mergePdfs(documents);
  } catch {
    return unprocessable(LetterErrors.documentUnreadable, LetterI18n.documentUnreadable);
  }
  // readTenantFile reads no more than MAX_DOCUMENT_BYTES, so a larger merged letter could be approved but never sent.
  const check = await checkPostalPdf(merged, { maxBytes });
  if (!check.ok) {
    return unprocessable(LetterErrors.documentRejected, LetterI18n.documentRejected, {
      documentReason: check.reason,
      page: check.page,
      detail: check.detail,
    });
  }
  const sheetCount = sheetsFor(check.pageCount, letter.duplex);
  if (sheetCount > capabilities.maxSheets) {
    return unprocessable(LetterErrors.tooManySheets, LetterI18n.tooManySheets, {
      sheetCount,
      maxSheets: capabilities.maxSheets,
    });
  }
  const quote = await resolved.provider.quote({
    pageCount: check.pageCount,
    sheetCount,
    shippingMode,
    envelope: envelopeOf(letter),
    color: letter.color,
    duplex: letter.duplex,
  });
  return {
    isSuccess: true,
    data: { merged, pageCount: check.pageCount, sheetCount, quote, providerName: resolved.name },
  };
}
