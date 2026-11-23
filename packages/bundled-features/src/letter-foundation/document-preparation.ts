import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import {
  MAX_DOCUMENT_BYTES,
  readTenantFile,
  sumTenantFileSizes,
} from "../file-foundation/index.ts";
import { checkPostalPdf, mergePdfs, PdfPageLimitError, unprocessable } from "../shared/index.ts";
import { LetterErrors, LetterI18n } from "./constants.ts";
import type { LetterRow } from "./entity.ts";
import { resolveLetterProviderOrFailure } from "./provider-resolver.ts";
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

function fileTooLarge(bytes: number, maxBytes: number): WriteResult<never> {
  return unprocessable(LetterErrors.documentRejected, LetterI18n.documentRejected, {
    documentReason: "file-too-large",
    page: null,
    detail: `${bytes} bytes exceed the limit of ${maxBytes}`,
  });
}

type DocumentCtx = Pick<HandlerContext, "db" | "services">;

/** Reads the parts in order and stops at the first one that is missing or pushes the total over the limit. */
async function readDocuments(
  ctx: DocumentCtx,
  user: SessionUser,
  fileRefIds: readonly string[],
  maxBytes: number,
): Promise<WriteResult<Uint8Array[]>> {
  const storedBytes = await sumTenantFileSizes(ctx, user.tenantId, fileRefIds);
  if (storedBytes !== null && storedBytes > maxBytes) {
    return fileTooLarge(storedBytes, maxBytes);
  }
  const documents: Uint8Array[] = [];
  let totalBytes = 0;
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
      return fileTooLarge(totalBytes, maxBytes);
    }
    documents.push(file.content);
  }
  if (documents.length === 0) return unprocessable(LetterErrors.noFiles, LetterI18n.noFiles);
  return { isSuccess: true, data: documents };
}

async function mergeWithinSheetLimit(
  documents: readonly Uint8Array[],
  duplex: boolean,
  maxSheets: number,
): Promise<WriteResult<Uint8Array>> {
  try {
    const merged = await mergePdfs(documents, {
      maxPages: duplex ? maxSheets * 2 : maxSheets,
      startEachFileOnNewSheet: duplex,
    });
    return { isSuccess: true, data: merged };
  } catch (error) {
    if (error instanceof PdfPageLimitError) {
      return unprocessable(LetterErrors.tooManySheets, LetterI18n.tooManySheets, {
        sheetCount: sheetsFor(error.pageCount, duplex),
        maxSheets,
      });
    }
    return unprocessable(LetterErrors.documentUnreadable, LetterI18n.documentUnreadable);
  }
}

/** Merges the letter's documents, checks them against the provider's limits and asks for the price.
 *  Calls the provider, so it never runs inside an open database transaction. */
export async function prepareLetterDocument(
  ctx: Pick<HandlerContext, "db" | "services" | "registry">,
  user: SessionUser,
  letter: LetterRow,
): Promise<WriteResult<PreparedLetterDocument>> {
  const providerResult = await resolveLetterProviderOrFailure(ctx.registry);
  if (!providerResult.isSuccess) return providerResult;
  const resolved = providerResult.data;
  const { capabilities } = resolved;

  const maxBytes = Math.min(capabilities.maxBytes, MAX_DOCUMENT_BYTES);
  const { fileRefIds, shippingMode } = letter;
  if (!isStringList(fileRefIds) || !isLetterShippingMode(shippingMode)) {
    return unprocessable(LetterErrors.documentUnreadable, LetterI18n.documentUnreadable);
  }
  const documents = await readDocuments(ctx, user, fileRefIds, maxBytes);
  if (!documents.isSuccess) return documents;
  const mergedResult = await mergeWithinSheetLimit(
    documents.data,
    letter.duplex,
    capabilities.maxSheets,
  );
  if (!mergedResult.isSuccess) return mergedResult;
  const merged = mergedResult.data;
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
