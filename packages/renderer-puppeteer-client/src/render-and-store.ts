import { fileContextForTenant } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import {
  collectRendererPlugins,
  type DocumentPdfDraft,
  type RenderedTemplateRef,
  type RendererContext,
  RendererError,
  selectRendererPlugin,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverApi,
  isVariantSlugOf,
  readVariantOf,
  TemplateNotFoundError,
  VARIANT_UNKNOWN_REASON,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type { ReservationRelease } from "@cosmicdrift/kumiko-types/handlers";
import type {
  BeforeTransactionContext,
  BeforeTransactionResult,
  HandlerContext,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type KumikoError,
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import {
  createFileRefFromUploadedBytes,
  type UploadedFileBytes,
  uploadFileBytesBeforeTransaction,
} from "@cosmicdrift/kumiko-framework/files";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { buildDocumentDraftPdfRequest } from "./document-pdf.ts";
import { printDocumentPdf } from "./document-pdf-print.ts";
import { PuppeteerUnavailableError } from "./errors.ts";
import { renderedPdfExecutor } from "./executor.ts";
import { countPdfPages } from "./pdf-page-count.ts";
import { loadClientConfigOrUnavailable } from "./render.ts";

const PDF_MIME_TYPE = "application/pdf";
const INVALID_REQUEST_REASON = "rendered_pdf_invalid_request";
const PDF_TOO_LARGE_REASON = "rendered_pdf_too_large";

export type RenderPdfArgs = {
  readonly slug: string;
  /** Slug of a variant of `slug` (`<slug>:<name>`), as listed by the template-resolver `variants` query; rendered instead of the base. */
  readonly variant?: string;
  readonly locale: string;
  readonly variables: Readonly<Record<string, unknown>>;
  /** An unsaved or per-subject version of the template to print instead of the stored one; the stored template of the slug still supplies images, layout and the variable schema. */
  readonly draft?: DocumentPdfDraft;
  readonly attachTo?: {
    readonly entityType: string;
    readonly fieldName: string;
    readonly entityId?: string;
  };
};

export type RenderedPdfUpload = {
  readonly upload: UploadedFileBytes;
  readonly slug: string;
  readonly locale: string;
  readonly template: RenderedTemplateRef;
  readonly layout?: RenderedTemplateRef;
  readonly pageCount: number;
  readonly sizeBytes: number;
};

export type StoredRenderedPdf = {
  readonly renderedPdfId: string;
  readonly fileRefId: string;
  readonly fileName: string;
  readonly pageCount: number;
  readonly sizeBytes: number;
  readonly template: RenderedTemplateRef;
  readonly layout?: RenderedTemplateRef;
};

// Rendering runs before the transaction too, where the context has no events or dispatch.write.
type RenderContext = HandlerContext | BeforeTransactionContext;

// Maps the renderer errors a caller can act on to client errors; anything else is a bug and throws.
export function clientErrorForRenderFailure(
  e: unknown,
  ctx: RenderContext,
  slug: string,
): KumikoError {
  const log = createFallbackLogger("renderer-puppeteer-client", ctx.obs.log);
  if (e instanceof RendererError && e.code === "unavailable") {
    log.error("PDF service unavailable", { cause: e.message });
    return new PuppeteerUnavailableError();
  }
  if (e instanceof RendererError && e.code === "invalid_payload") {
    // The cause names the service response or the template; the client only gets the reason code.
    log.error("PDF request rejected", { slug, cause: e.message });
    return new UnprocessableError(INVALID_REQUEST_REASON);
  }
  if (e instanceof RendererError && e.code === "payload_too_large") {
    log.error("PDF request too large for the service", { slug, cause: e.message });
    return new UnprocessableError(PDF_TOO_LARGE_REASON, { details: { ...e.limits } });
  }
  throw e;
}

function renderFailure(e: unknown, ctx: RenderContext, slug: string): WriteResult<never> {
  return writeFailure(clientErrorForRenderFailure(e, ctx, slug));
}

function renderedSlugOf(args: Pick<RenderPdfArgs, "slug" | "variant">): string {
  return args.variant ?? args.slug;
}

// A variant counts only when the resolver serves it to this tenant and it names exactly this base.
async function isUnknownVariant(
  ctx: RenderContext,
  args: Pick<RenderPdfArgs, "slug" | "variant" | "locale">,
): Promise<boolean> {
  const { variant } = args;
  if (variant === undefined) return false;
  if (!isVariantSlugOf(variant, args.slug)) return true;
  try {
    const resource = await createTemplateResolverApi(ctx.db, ctx.registry).resolveTemplate({
      tenantId: ctx.user.tenantId,
      slug: variant,
      kind: "document-pdf",
      locale: args.locale,
    });
    return readVariantOf(resource.meta) !== args.slug;
  } catch (e) {
    if (e instanceof TemplateNotFoundError) return true;
    throw e;
  }
}

export type RenderedPdfBytes = {
  readonly fileName: string;
  readonly pdfBytes: Uint8Array;
  readonly pageCount: number;
  readonly sizeBytes: number;
  readonly template: RenderedTemplateRef;
  readonly layout?: RenderedTemplateRef;
};

function rendererContextOf(ctx: RenderContext, tenantId: string): RendererContext {
  return {
    db: ctx.db,
    registry: ctx.registry,
    tenantId,
    ...(ctx.config !== undefined && { config: ctx.config }),
    filesForTenant: (fileTenantId) => fileContextForTenant(ctx, tenantId, fileTenantId),
  };
}

async function printDraftPdfBytes(
  ctx: RenderContext,
  args: Pick<RenderPdfArgs, "locale" | "variables">,
  renderedSlug: string,
  draft: DocumentPdfDraft,
): Promise<WriteResult<RenderedPdfBytes>> {
  try {
    const built = await buildDocumentDraftPdfRequest(
      { slug: renderedSlug, locale: args.locale, variables: args.variables, draft },
      rendererContextOf(ctx, ctx.user.tenantId),
    );
    const pdfBytes = await printDocumentPdf(loadClientConfigOrUnavailable(), built);
    return {
      isSuccess: true,
      data: {
        fileName: built.fileName,
        pdfBytes,
        pageCount: countPdfPages(pdfBytes),
        sizeBytes: pdfBytes.byteLength,
        template: built.template,
        ...(built.layout !== null && { layout: built.layout }),
      },
    };
  } catch (e) {
    return renderFailure(e, ctx, renderedSlug);
  }
}

// Renders without storing: no file, no rendered-pdf row. For callers that keep the bytes
// themselves (mail attachment, download); same no-transaction rule as renderPdfBeforeTransaction.
export async function renderPdfBytes(
  ctx: RenderContext,
  args: Pick<RenderPdfArgs, "slug" | "variant" | "locale" | "variables" | "draft">,
): Promise<WriteResult<RenderedPdfBytes>> {
  const tenantId = ctx.user.tenantId;
  if (await isUnknownVariant(ctx, args)) {
    return writeFailure(
      new UnprocessableError(VARIANT_UNKNOWN_REASON, {
        i18nKey: "templateResolver.errors.variantUnknown",
        i18nParams: { variant: args.variant ?? args.slug },
      }),
    );
  }
  const renderedSlug = renderedSlugOf(args);
  if (args.draft !== undefined) return printDraftPdfBytes(ctx, args, renderedSlug, args.draft);
  const plugin = selectRendererPlugin(collectRendererPlugins(ctx.registry), "document-pdf");

  let response: Awaited<ReturnType<typeof plugin.render>>;
  try {
    response = await plugin.render(
      {
        kind: "document-pdf",
        payload: { slug: renderedSlug, locale: args.locale, variables: args.variables },
      },
      rendererContextOf(ctx, tenantId),
    );
  } catch (e) {
    return renderFailure(e, ctx, renderedSlug);
  }
  if (response.kind !== "document-pdf") {
    throw new RendererError(
      `renderer "${plugin.name}" answered a document-pdf request with kind "${response.kind}"`,
      "other",
    );
  }
  const { template, layout } = response;
  if (template === undefined) {
    throw new RendererError(
      `renderer "${plugin.name}" did not report which template produced the PDF`,
      "other",
    );
  }

  return {
    isSuccess: true,
    data: {
      fileName: response.fileName,
      pdfBytes: response.pdfBytes,
      pageCount: response.pageCount,
      sizeBytes: response.sizeBytes,
      template,
      ...(layout !== undefined && { layout }),
    },
  };
}

// Renders and uploads the PDF while no transaction is open: the print service call can take
// seconds and must not hold a pool connection. Use as a handler's `beforeTransaction`.
export async function renderPdfBeforeTransaction(
  ctx: RenderContext,
  args: RenderPdfArgs,
): Promise<BeforeTransactionResult<RenderedPdfUpload>> {
  const rendered = await renderPdfBytes(ctx, args);
  if (!rendered.isSuccess) return rendered;
  const { fileName, pdfBytes, pageCount, sizeBytes, template, layout } = rendered.data;

  const tenantId = ctx.user.tenantId;
  const uploaded = await uploadFileBytesBeforeTransaction(
    {
      db: ctx.db,
      services: { files: fileContextForTenant(ctx, tenantId, tenantId) },
      registry: ctx.registry,
      user: ctx.user,
    },
    {
      fileName,
      mimeType: PDF_MIME_TYPE,
      data: pdfBytes,
      ...(args.attachTo !== undefined && { attachTo: args.attachTo }),
    },
  );
  if (!uploaded.isSuccess) return uploaded;

  return {
    isSuccess: true,
    data: {
      upload: uploaded.data,
      slug: renderedSlugOf(args),
      locale: args.locale,
      template,
      ...(layout !== undefined && { layout }),
      pageCount,
      sizeBytes,
    },
    ...(uploaded.release && { release: uploaded.release }),
  };
}

// Half of the puppeteer service's default MAX_CONCURRENT_RENDERS (4): a batch finishes sooner than a
// serial loop and still leaves slots for other tenants' single prints.
const PDF_BATCH_CONCURRENCY = 2;

// Several PDFs for one write. One failed document stops the batch and removes every file it already
// uploaded; the returned release removes all of them when the write fails or rolls back.
export async function renderPdfsBeforeTransaction(
  ctx: RenderContext,
  documents: readonly RenderPdfArgs[],
): Promise<BeforeTransactionResult<readonly RenderedPdfUpload[]>> {
  const uploads: Array<RenderedPdfUpload | undefined> = [];
  const releases: ReservationRelease[] = [];
  let failure: WriteFailure | undefined;
  let halted = false;
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (!halted && nextIndex < documents.length) {
      const index = nextIndex++;
      const document = documents[index];
      if (document === undefined) return;
      let rendered: Awaited<ReturnType<typeof renderPdfBeforeTransaction>>;
      try {
        rendered = await renderPdfBeforeTransaction(ctx, document);
      } catch (e) {
        halted = true;
        throw e;
      }
      if (!rendered.isSuccess) {
        failure ??= rendered;
        halted = true;
        return;
      }
      uploads[index] = rendered.data;
      if (rendered.release) releases.push(rendered.release);
    }
  };

  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(PDF_BATCH_CONCURRENCY, documents.length) }, () => worker()),
  );
  const releaseAll = async (): Promise<void> => {
    await Promise.allSettled(releases.map((release) => release()));
  };

  const thrown = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (thrown !== undefined) {
    await releaseAll();
    throw thrown.reason;
  }
  if (failure !== undefined) {
    await releaseAll();
    return failure;
  }

  return {
    isSuccess: true,
    data: uploads.filter((upload): upload is RenderedPdfUpload => upload !== undefined),
    ...(releases.length > 0 && { release: releaseAll }),
  };
}

// Transaction half: writes the fileRef and rendered-pdf rows for a PDF renderPdfBeforeTransaction produced.
export async function storeRenderedPdf(
  ctx: HandlerContext,
  rendered: RenderedPdfUpload,
): Promise<WriteResult<StoredRenderedPdf>> {
  const stored = await createFileRefFromUploadedBytes(ctx, rendered.upload);
  if (!stored.isSuccess) return stored;

  const { template, layout } = rendered;
  const renderedPdfId = generateId();
  const created = await renderedPdfExecutor.create(
    {
      id: renderedPdfId,
      fileRefId: stored.data.id,
      templateSlug: rendered.slug,
      locale: rendered.locale,
      templateId: template.templateId,
      templateVersion: template.templateVersion,
      templateScope: template.scope,
      layoutId: layout?.templateId ?? null,
      layoutVersion: layout?.templateVersion ?? null,
      pageCount: rendered.pageCount,
    },
    ctx.user,
    ctx.db,
  );
  if (!created.isSuccess) return created;

  return {
    isSuccess: true,
    data: {
      renderedPdfId,
      fileRefId: stored.data.id,
      fileName: stored.data.fileName,
      pageCount: rendered.pageCount,
      sizeBytes: rendered.sizeBytes,
      template,
      ...(layout !== undefined && { layout }),
    },
  };
}
