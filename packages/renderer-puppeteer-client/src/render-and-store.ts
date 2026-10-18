import { fileContextForTenant } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  type RenderedTemplateRef,
  RendererError,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import type {
  BeforeTransactionResult,
  HandlerContext,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type KumikoError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import {
  createFileRefFromUploadedBytes,
  type UploadedFileBytes,
  uploadFileBytesBeforeTransaction,
} from "@cosmicdrift/kumiko-framework/files";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { PuppeteerUnavailableError } from "./errors.ts";
import { renderedPdfExecutor } from "./executor.ts";

const PDF_MIME_TYPE = "application/pdf";
const INVALID_REQUEST_REASON = "rendered_pdf_invalid_request";

export type RenderPdfArgs = {
  readonly slug: string;
  readonly locale: string;
  readonly variables: Readonly<Record<string, unknown>>;
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

// Maps the renderer errors a caller can act on to client errors; anything else is a bug and throws.
export function clientErrorForRenderFailure(
  e: unknown,
  ctx: HandlerContext,
  slug: string,
): KumikoError {
  const log = createFallbackLogger("renderer-puppeteer-client", ctx.log);
  if (e instanceof RendererError && e.code === "unavailable") {
    log.error("PDF service unavailable", { cause: e.message });
    return new PuppeteerUnavailableError();
  }
  if (e instanceof RendererError && e.code === "invalid_payload") {
    // The cause names the service response or the template; the client only gets the reason code.
    log.error("PDF request rejected", { slug, cause: e.message });
    return new UnprocessableError(INVALID_REQUEST_REASON);
  }
  throw e;
}

function renderFailure(e: unknown, ctx: HandlerContext, slug: string): WriteResult<never> {
  return writeFailure(clientErrorForRenderFailure(e, ctx, slug));
}

// Renders and uploads the PDF while no transaction is open: the print service call can take
// seconds and must not hold a pool connection. Use as a handler's `beforeTransaction`.
export async function renderPdfBeforeTransaction(
  ctx: HandlerContext,
  args: RenderPdfArgs,
): Promise<BeforeTransactionResult<RenderedPdfUpload>> {
  const tenantId = ctx.user.tenantId;
  const plugin = createRendererFoundationApi(
    collectRendererPlugins(ctx.registry),
  ).createRendererForTenant({ tenantId, kind: "document-pdf" });

  let response: Awaited<ReturnType<typeof plugin.render>>;
  try {
    response = await plugin.render(
      {
        kind: "document-pdf",
        payload: { slug: args.slug, locale: args.locale, variables: args.variables },
      },
      {
        db: ctx.db,
        registry: ctx.registry,
        tenantId,
        ...(ctx.config !== undefined && { config: ctx.config }),
        filesForTenant: (fileTenantId) => fileContextForTenant(ctx, tenantId, fileTenantId),
      },
    );
  } catch (e) {
    return renderFailure(e, ctx, args.slug);
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

  const uploaded = await uploadFileBytesBeforeTransaction(
    {
      db: ctx.db,
      files: fileContextForTenant(ctx, tenantId, tenantId),
      registry: ctx.registry,
      user: ctx.user,
    },
    {
      fileName: response.fileName,
      mimeType: PDF_MIME_TYPE,
      data: response.pdfBytes,
      ...(args.attachTo !== undefined && { attachTo: args.attachTo }),
    },
  );
  if (!uploaded.isSuccess) return uploaded;

  return {
    isSuccess: true,
    data: {
      upload: uploaded.data,
      slug: args.slug,
      locale: args.locale,
      template,
      ...(layout !== undefined && { layout }),
      pageCount: response.pageCount,
      sizeBytes: response.sizeBytes,
    },
    ...(uploaded.release && { release: uploaded.release }),
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
