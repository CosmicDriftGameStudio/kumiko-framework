import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
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
import type { EmailAttachmentRef } from "./attachment-ref.js";
import type { ChannelContext, RenderedMail } from "./types.js";

function createMailRenderer(
  db: DbConnection,
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
      ...(response.attachments !== undefined && { attachments: response.attachments }),
    };
  };
}

const INLINE_IMAGE_CONTENT_TYPE_PREFIX = "image/";

// Inline images may come from the system tenant (system template or tenant override of
// one); file attachments only from the job's own tenant. Inline content that is not an
// image is dropped, so a swapped fileRef id cannot smuggle a document into the mail body.
function createAttachmentReader(
  db: DbConnection,
  tenantId: TenantId,
  filesForTenant: (tenantId: string) => FileContext | undefined,
): NonNullable<ChannelContext["readAttachment"]> {
  return async (ref: EmailAttachmentRef) => {
    const found = await readFileRefContent({
      db,
      filesForTenant,
      fileRefId: ref.fileRefId,
      allowedTenantIds: ref.kind === "inline" ? [tenantId, SYSTEM_TENANT_ID] : [tenantId],
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
    renderMail: createMailRenderer(db, registry, tenantId, tenantConfig),
    ...(filesForTenant !== undefined && {
      readAttachment: createAttachmentReader(db, tenantId, filesForTenant),
    }),
  };
}
