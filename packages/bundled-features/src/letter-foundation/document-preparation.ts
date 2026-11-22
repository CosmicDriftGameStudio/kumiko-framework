import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { MAX_DOCUMENT_BYTES, readTenantFile } from "../file-foundation/index.ts";
import { checkPostalPdf, mergePdfs, unprocessable } from "../shared/index.ts";
import { LetterErrors, LetterI18n } from "./constants.ts";
import type { letterExecutor } from "./entity.ts";
import { resolveLetterProvider } from "./provider-resolver.ts";
import { isLetterEnvelope, isLetterShippingMode, isStringList } from "./row-guards.ts";
import type { LetterQuote } from "./types.ts";

type LetterRow = NonNullable<Awaited<ReturnType<typeof letterExecutor.detail>>>;

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
    documents.push(file.content);
  }
  if (documents.length === 0) return unprocessable(LetterErrors.noFiles, LetterI18n.noFiles);

  let merged: Uint8Array;
  try {
    merged = await mergePdfs(documents);
  } catch {
    return unprocessable(LetterErrors.documentUnreadable, LetterI18n.documentUnreadable);
  }
  const check = await checkPostalPdf(merged, {
    // readTenantFile reads no more than MAX_DOCUMENT_BYTES, so a larger merged letter could be approved but never sent.
    maxBytes: Math.min(capabilities.maxBytes, MAX_DOCUMENT_BYTES),
  });
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
    envelope: isLetterEnvelope(letter.envelope) ? letter.envelope : "folded",
    color: letter.color,
    duplex: letter.duplex,
  });
  return {
    isSuccess: true,
    data: { merged, pageCount: check.pageCount, sheetCount, quote, providerName: resolved.name },
  };
}
