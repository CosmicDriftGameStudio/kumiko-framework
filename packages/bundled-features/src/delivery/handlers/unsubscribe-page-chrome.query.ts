import { access, defineQueryHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  type MailChrome,
  RendererError,
  type RendererPlugin,
} from "../../renderer-foundation/index.js";

function mailChromePlugin(
  plugins: readonly RendererPlugin[],
  tenantId: TenantId,
): RendererPlugin | null {
  try {
    const plugin = createRendererFoundationApi(plugins).createRendererForTenant({
      tenantId,
      kind: "mail",
    });
    return plugin.readMailChrome === undefined ? null : plugin;
  } catch (e) {
    if (e instanceof RendererError && e.code === "no_plugin_for_kind") return null;
    throw e;
  }
}

export const unsubscribePageChromeQuery = defineQueryHandler({
  name: "unsubscribePageChrome",
  schema: z.object({ locale: z.string().min(2).max(35) }),
  access: { roles: access.systemAdmin },
  // Only reachable via createUnsubscribeRoutes' dispatchSystemQuery once verify()
  // proved the token signature.
  agent: { expose: false },
  description:
    "Returns the tenant's mail brand row and footer resolved for one locale, or null without a mail renderer; dispatched by the signed unsubscribe route to dress its pages like the mail, not meant for UI callers.",
  handler: async (query, ctx): Promise<MailChrome | null> => {
    const { tenantId } = query.user;
    if (!ctx.systemDb) {
      throw new InternalError({
        message: "unsubscribePageChrome: ctx.systemDb missing on a system-scoped handler",
      });
    }
    const plugin = mailChromePlugin(collectRendererPlugins(ctx.registry), tenantId);
    if (plugin?.readMailChrome === undefined) return null;
    return plugin.readMailChrome(
      { locale: query.payload.locale },
      {
        db: ctx.systemDb.assertTenantMatch(tenantId),
        registry: ctx.registry,
        tenantId,
        ...(ctx.config !== undefined && { config: ctx.config }),
      },
    );
  },
});
