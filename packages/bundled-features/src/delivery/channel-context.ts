import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { ConfigAccessor, Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  type MailPayload,
  RendererError,
} from "../renderer-foundation/index.js";
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
    };
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
): ChannelContext {
  return {
    db: createTenantDb(db, tenantId),
    registry,
    sseBroker,
    tenantId,
    secrets,
    renderMail: createMailRenderer(db, registry, tenantId, tenantConfig),
  };
}
