import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { RendererError } from "../renderer-foundation/index.ts";
import { requestExecutor, signerExecutor } from "./entity.ts";
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
  SIGNATURE_SIGNER_STATUS,
  type SignatureFailureReason,
  SignatureInternalHandlers,
} from "./web/constants.ts";

// Equals the executor's MAX_LIST_LIMIT.
const SWEEP_PAGE_SIZE = 200;

type RequestPage = Awaited<ReturnType<typeof requestExecutor.list>>;

// Keyset-paged, so rows that leave the status while the sweep works on them cannot shift the next page.
export async function forEachRequestPageWithStatus(
  ctx: JobContext,
  status: string,
  visitPage: (requests: readonly RequestRow[]) => Promise<void>,
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
    await visitPage(page.rows);
    cursor = page.nextCursor;
  } while (cursor !== null);
}

// One grouped count per page instead of a reconcile write per open request: most open requests
// still wait for a signer, and reconciling them would load the signers only to change nothing.
async function requestIdsWithUnsignedSigners(
  ctx: JobContext,
  requestIds: readonly string[],
): Promise<ReadonlySet<string> | null> {
  if (requestIds.length === 0) return new Set();
  const result = await signerExecutor.aggregate(
    {
      filters: [
        { field: "requestId", op: "in", value: requestIds },
        { field: "status", op: "ne", value: SIGNATURE_SIGNER_STATUS.Signed },
      ],
      aggregate: { groupBy: "requestId", measures: [] },
    },
    ctx.systemUser,
    ctx.db,
  );
  if (result.truncated === true) return null;
  return new Set(
    result.groups.flatMap((group) => (typeof group.key === "string" ? [group.key] : [])),
  );
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
  const sorted = [...signers].sort(bySignedAt);
  const entries = await Promise.all(
    sorted.map(async (signer): Promise<SignaturePageEntry | null> => {
      const signedAt = instantOrNull(signer.signedAt);
      if (signedAt === null || typeof signer.imageFileId !== "string") return null;
      const image = await readTenantFile(ctx, ctx.systemUser.tenantId, signer.imageFileId);
      if (image === null) return null;
      return {
        name: signer.name,
        role: signer.role ?? null,
        signedAtIso: signedAt.toString(),
        method:
          signer.method === SIGNATURE_METHOD.Link
            ? SIGNATURE_METHOD.Link
            : SIGNATURE_METHOD.InPerson,
        imagePng: image.content,
      };
    }),
  );
  const present = entries.filter((entry): entry is SignaturePageEntry => entry !== null);
  return present.length === entries.length ? present : null;
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

// The service's size limit does not change between runs, so an oversized page never prints;
// an outage or any other error still throws and the next run retries.
async function renderSignaturePages(
  opts: SignatureOptions,
  html: string,
): Promise<Uint8Array | null> {
  try {
    return await opts.renderHtmlToPdf(html);
  } catch (error) {
    if (error instanceof RendererError && error.code === "payload_too_large") return null;
    throw error;
  }
}

// Appends the signature page to the unchanged original. A missing or changed original, a missing
// signature image or a signature page above the renderer's size limit can never heal and ends the
// request as failed. A renderer outage throws, the request stays all-signed and the next run tries again.
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
  const signaturePages = await renderSignaturePages(opts, html);
  if (signaturePages === null) {
    await failRequest(ctx, request, SIGNATURE_FAILURE_REASON.SignaturePageTooLarge);
    return;
  }
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
  await forEachRequestPageWithStatus(ctx, SIGNATURE_REQUEST_STATUS.Open, async (requests) => {
    const running: RequestRow[] = [];
    for (const request of requests) {
      if (isPastInstant(request.expiresAt, now)) {
        await ctx.dispatch.write(SignatureInternalHandlers.expire, { requestId: request.id });
      } else {
        running.push(request);
      }
    }
    const unsigned = await requestIdsWithUnsignedSigners(
      ctx,
      running.map((request) => request.id),
    );
    for (const request of running) {
      if (unsigned?.has(request.id) === true) continue;
      await ctx.dispatch.write(SignatureInternalHandlers.reconcile, { requestId: request.id });
    }
  });
  await forEachRequestPageWithStatus(ctx, SIGNATURE_REQUEST_STATUS.AllSigned, async (requests) => {
    for (const request of requests) {
      try {
        await finalizeRequest(ctx, opts, request);
      } catch (error) {
        ctx.obs.log.warn("[signature:sweep] completing failed, retrying on the next run", {
          requestId: request.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}
