import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { requestExecutor } from "./entity.ts";
import {
  discardGeneratedFile,
  PDF_MIME_TYPE,
  readTenantFile,
  sha256Hex,
  storeGeneratedFile,
} from "./files.ts";
import {
  instantOrNull,
  isPastInstant,
  listSigners,
  type RequestRow,
  type SignerRow,
} from "./lib.ts";
import type { SignatureOptions } from "./options.ts";
import {
  appendPdfPages,
  buildSignaturePageHtml,
  DEFAULT_SIGNATURE_PAGE_LABELS,
  type SignaturePageEntry,
} from "./signature-page.ts";
import {
  SIGNATURE_FAILURE_REASON,
  SIGNATURE_METHOD,
  SIGNATURE_REQUEST_STATUS,
  type SignatureFailureReason,
  SignatureInternalHandlers,
} from "./web/constants.ts";

// Equals the executor's MAX_LIST_LIMIT.
const SWEEP_PAGE_SIZE = 200;

type RequestPage = Awaited<ReturnType<typeof requestExecutor.list>>;

// Keyset-paged, so rows that leave the status while the sweep works on them cannot shift the next page.
async function forEachRequestWithStatus(
  ctx: JobContext,
  status: string,
  visit: (request: RequestRow) => Promise<void>,
): Promise<void> {
  let cursor: string | null = null;
  do {
    const page: RequestPage = await requestExecutor.list(
      {
        filter: { field: "status", op: "eq", value: status },
        limit: SWEEP_PAGE_SIZE,
        ...(cursor !== null && { cursor }),
      },
      ctx.systemUser,
      ctx.db,
    );
    for (const request of page.rows) await visit(request);
    cursor = page.nextCursor;
  } while (cursor !== null);
}

function bySignedAt(left: SignerRow, right: SignerRow): number {
  const a = instantOrNull(left.signedAt);
  const b = instantOrNull(right.signedAt);
  if (a === null || b === null) return 0;
  return Temporal.Instant.compare(a, b);
}

async function signaturePageEntries(
  ctx: JobContext,
  signers: readonly SignerRow[],
): Promise<readonly SignaturePageEntry[] | null> {
  const entries: SignaturePageEntry[] = [];
  for (const signer of [...signers].sort(bySignedAt)) {
    const signedAt = instantOrNull(signer.signedAt);
    if (signedAt === null || typeof signer.imageFileId !== "string") return null;
    const image = await readTenantFile(ctx, ctx.systemUser.tenantId, signer.imageFileId);
    if (image === null) return null;
    entries.push({
      name: signer.name,
      role: signer.role ?? null,
      signedAtIso: signedAt.toString(),
      method:
        signer.method === SIGNATURE_METHOD.Link ? SIGNATURE_METHOD.Link : SIGNATURE_METHOD.InPerson,
      imagePng: image.content,
    });
  }
  return entries;
}

async function failRequest(
  ctx: JobContext,
  request: RequestRow,
  reason: SignatureFailureReason,
): Promise<void> {
  const failed = await ctx.dispatch.write(SignatureInternalHandlers.fail, {
    requestId: request.id,
    reason,
  });
  if (!failed.isSuccess) {
    ctx.obs.log.error("[signature:sweep] marking the request failed was rejected", {
      requestId: request.id,
      reason,
      error: failed.error,
    });
    return;
  }
  if (propertyOf(failed.data, "failed") === true) {
    ctx.obs.log.warn("[signature:sweep] request cannot be completed, marked failed", {
      requestId: request.id,
      reason,
    });
  }
}

// Appends the signature page to the unchanged original. A missing or changed original or a
// missing signature image can never heal and ends the request as failed. A renderer outage
// throws, the request stays all-signed and the next run tries again.
async function finalizeRequest(
  ctx: JobContext,
  opts: SignatureOptions,
  request: RequestRow,
): Promise<void> {
  const original = await readTenantFile(ctx, ctx.systemUser.tenantId, request.documentFileId);
  if (original === null || sha256Hex(original.content) !== request.documentSha256) {
    await failRequest(ctx, request, SIGNATURE_FAILURE_REASON.DocumentChanged);
    return;
  }
  const entries = await signaturePageEntries(
    ctx,
    await listSigners(ctx, ctx.systemUser, request.id),
  );
  if (entries === null) {
    await failRequest(ctx, request, SIGNATURE_FAILURE_REASON.SignatureImageMissing);
    return;
  }
  const html = buildSignaturePageHtml({
    title: request.title,
    documentSha256: request.documentSha256,
    entries,
    labels: DEFAULT_SIGNATURE_PAGE_LABELS,
  });
  const signaturePages = await opts.renderHtmlToPdf(html);
  const completed = await appendPdfPages(original.content, signaturePages);
  const stored = await storeGeneratedFile(ctx, ctx.systemUser, {
    fileName: "signed-document.pdf",
    mimeType: PDF_MIME_TYPE,
    data: completed,
  });
  if (!stored.isSuccess) {
    ctx.obs.log.warn("[signature:sweep] storing the completed pdf failed", {
      requestId: request.id,
    });
    return;
  }
  const finished = await ctx.dispatch.write(SignatureInternalHandlers.finish, {
    requestId: request.id,
    completedFileId: stored.data.id,
  });
  if (!finished.isSuccess || propertyOf(finished.data, "finished") !== true) {
    await discardGeneratedFile(ctx, ctx.systemUser, stored.data);
  }
}

export async function sweepSignatureRequests(
  ctx: JobContext,
  opts: SignatureOptions,
): Promise<void> {
  const now = ctx.tz.now();
  await forEachRequestWithStatus(ctx, SIGNATURE_REQUEST_STATUS.Open, async (request) => {
    const qn = isPastInstant(request.expiresAt, now)
      ? SignatureInternalHandlers.expire
      : SignatureInternalHandlers.reconcile;
    await ctx.dispatch.write(qn, { requestId: request.id });
  });
  await forEachRequestWithStatus(ctx, SIGNATURE_REQUEST_STATUS.AllSigned, async (request) => {
    try {
      await finalizeRequest(ctx, opts, request);
    } catch (error) {
      ctx.obs.log.warn("[signature:sweep] completing failed, retrying on the next run", {
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
