import { fileContextForTenant } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  type RenderedTemplateRef,
  RendererError,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverApi,
  isVariantSlugOf,
  readVariantOf,
  TemplateNotFoundError,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type {
  BeforeTransactionContext,
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

export const VARIANT_UNKNOWN_REASON = "template_variant_unknown";

export type RenderPdfArgs = {
  readonly slug: string;
  /** Slug of a variant of `slug` (`<slug>:<name>`), as listed by the template-resolver `variants` query; rendered instead of the base. */
  readonly variant?: string;
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

// Renders without storing: no file, no rendered-pdf row. For callers that keep the bytes
// themselves (mail attachment, download); same no-transaction rule as renderPdfBeforeTransaction.
export async function renderPdfBytes(
  ctx: RenderContext,
  args: Pick<RenderPdfArgs, "slug" | "variant" | "locale" | "variables">,
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
  const plugin = createRendererFoundationApi(
    collectRendererPlugins(ctx.registry),
  ).createRendererForTenant({ tenantId, kind: "document-pdf" });

  let response: Awaited<ReturnType<typeof plugin.render>>;
  try {
    response = await plugin.render(
      {
        kind: "document-pdf",
        payload: { slug: renderedSlug, locale: args.locale, variables: args.variables },
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
