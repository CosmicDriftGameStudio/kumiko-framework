import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import { createTenantDb, type DbConnection, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { ConfigAccessor, Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { FileContext } from "@cosmicdrift/kumiko-framework/files";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { readFileRefContent } from "../file-foundation/index.js";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  type MailPayload,
  RendererError,
} from "../renderer-foundation/index.js";
import { FALLBACK_LOCALE } from "../template-resolver/index.js";
import type { EmailAttachmentRef, RenderedPdfAttachmentRef } from "./attachment-ref.js";
import type { AttachmentOrigin, ChannelContext, RenderedMail } from "./types.js";

export function createTemplateMailRenderer(
  db: DbConnection | TenantDb,
  registry: Registry,
  tenantId: TenantId,
  config: ConfigAccessor | undefined,
): (payload: MailPayload) => Promise<RenderedMail> {
  return async (payload) => {
    const plugin = createRendererFoundationApi(
      collectRendererPlugins(registry),
    ).createRendererForTenant({ tenantId, kind: "mail" });
    const response = await plugin.render(
      { kind: "mail", payload },
      { db, registry, tenantId, ...(config !== undefined && { config }) },
    );
    if (response.kind !== "mail") {
      throw new RendererError(
        `[delivery] renderer "${plugin.name}" answered a mail request with kind "${response.kind}"`,
        "other",
      );
    }
    return {
      subject: response.subject,
      html: response.html,
      text: response.text,
      ...(response.previewText !== undefined && { previewText: response.previewText }),
      ...(response.fromName !== undefined && { fromName: response.fromName }),
      ...(response.replyTo !== undefined && { replyTo: response.replyTo }),
      ...(response.attachments !== undefined && { attachments: response.attachments }),
      ...(response.layout !== undefined && { layout: response.layout }),
    };
  };
}

const INLINE_IMAGE_CONTENT_TYPE_PREFIX = "image/";
const PDF_CONTENT_TYPE = "application/pdf";

// Renders at send time so the job payload carries variables, not bytes. A failure throws:
// the send job retries instead of mailing without the document the recipient expects.
function createPdfRenderer(
  db: DbConnection | TenantDb,
  registry: Registry,
  tenantId: TenantId,
  config: ConfigAccessor | undefined,
  filesForTenant: (tenantId: string) => FileContext | undefined,
) {
  return async (ref: RenderedPdfAttachmentRef) => {
    const plugin = createRendererFoundationApi(
      collectRendererPlugins(registry),
    ).createRendererForTenant({ tenantId, kind: "document-pdf" });
    const response = await plugin.render(
      {
        kind: "document-pdf",
        payload: {
          slug: ref.templateSlug,
          locale: ref.locale ?? FALLBACK_LOCALE,
          variables: ref.variables,
        },
      },
      { db, registry, tenantId, filesForTenant, ...(config !== undefined && { config }) },
    );
    if (response.kind !== "document-pdf") {
      throw new RendererError(
        `[delivery] renderer "${plugin.name}" answered a document-pdf request with kind "${response.kind}"`,
        "other",
      );
    }
    return { content: response.pdfBytes, contentType: PDF_CONTENT_TYPE };
  };
}

// Inline images and file attachments the renderer took from a template may come from the system
// tenant (system template or tenant override of one). A file ref from notify data stays limited to
// the job's own tenant, since a caller picks it. Inline content that is not an image is dropped, so
// a swapped fileRef id cannot smuggle a document into the mail body.
export function createEmailAttachmentReader(
  db: DbConnection | TenantDb,
  registry: Registry,
  tenantId: TenantId,
  config: ConfigAccessor | undefined,
  filesForTenant: (tenantId: string) => FileContext | undefined,
): NonNullable<ChannelContext["readAttachment"]> {
  const renderPdf = createPdfRenderer(db, registry, tenantId, config, filesForTenant);
  return async (ref: EmailAttachmentRef, origin: AttachmentOrigin = "message") => {
    if (ref.kind === "rendered-pdf") return renderPdf(ref);
    const found = await readFileRefContent({
      db,
      filesForTenant,
      fileRefId: ref.fileRefId,
      allowedTenantIds:
        ref.kind === "file" && origin === "message" ? [tenantId] : [tenantId, SYSTEM_TENANT_ID],
    });
    if (found === null) return null;
    if (ref.kind === "inline" && !found.contentType.startsWith(INLINE_IMAGE_CONTENT_TYPE_PREFIX)) {
      return null;
    }
    return { content: found.content, contentType: found.contentType };
  };
}

// Build the per-tenant context a channel's resolve/render/send receives.
// Shared by the synchronous delivery-service path and the async job handlers
// (which pass sseBroker=undefined — only the inline inApp channel uses SSE,
// and it never runs through a job).
export function buildChannelContext(
  db: DbConnection,
  registry: Registry,
  sseBroker: SseBroker | undefined,
  tenantId: TenantId,
  secrets?: SecretsContext,
  tenantConfig?: ConfigAccessor,
  filesForTenant?: (tenantId: string) => FileContext | undefined,
): ChannelContext {
  return {
    db: createTenantDb(db, tenantId),
    registry,
    sseBroker,
    tenantId,
    secrets,
    renderMail: createTemplateMailRenderer(db, registry, tenantId, tenantConfig),
    ...(filesForTenant !== undefined && {
      readAttachment: createEmailAttachmentReader(
        db,
        registry,
        tenantId,
        tenantConfig,
        filesForTenant,
      ),
    }),
  };
}
