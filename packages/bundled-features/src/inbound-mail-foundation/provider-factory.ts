// Provider factory — mirrors mail-foundation's createTransportForTenant, including
// the three error paths (missing registry, unregistered provider, invalid plugin
// shape). Unlike the outbound pattern, there is no per-tenant config selector:
// the provider is specified per MailAccount (`account.provider`), so a tenant can
// use multiple providers in parallel.

import { INBOUND_MAIL_FOUNDATION_FEATURE, INBOUND_MAIL_PROVIDER_EXTENSION } from "./constants.ts";
import {
  type InboundMailContext,
  type InboundMailProviderPlugin,
  isInboundMailProviderPlugin,
  type MailAccountRecord,
} from "./types.ts";

/** Looks up a provider by key ("imap", "m365-graph", ...); used by OAuth
 *  connect routes before an account exists. */
export function resolveInboundProviderForKey(
  ctx: InboundMailContext,
  providerKey: string,
  handlerName = "inbound-mail-foundation:provider-factory",
): InboundMailProviderPlugin {
  if (!ctx.registry) {
    throw new Error(
      `${handlerName}: ctx.registry is missing — required to look up registered inbound-mail provider plugins`,
    );
  }
  const usages = ctx.registry.getExtensionUsages(INBOUND_MAIL_PROVIDER_EXTENSION);
  const usage = usages.find((u) => u.entityName === providerKey);
  if (!usage) {
    const known = usages.map((u) => u.entityName).join(", ") || "<none>";
    throw new Error(
      `${INBOUND_MAIL_FOUNDATION_FEATURE}: provider "${providerKey}" not registered. Known: ${known}. ` +
        `Mount the matching inbound-provider-${providerKey} feature.`,
    );
  }
  if (!isInboundMailProviderPlugin(usage.options)) {
    throw new Error(
      `${INBOUND_MAIL_FOUNDATION_FEATURE}: provider "${providerKey}" registered without verify()/fetch() — ` +
        `extension options must be an InboundMailProviderPlugin.`,
    );
  }
  return usage.options;
}

/** Looks up the provider for a specific account; the standard path for poll jobs
 *  and the watch supervisor. */
export function resolveInboundProviderForAccount(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  handlerName = "inbound-mail-foundation:provider-factory",
): InboundMailProviderPlugin {
  return resolveInboundProviderForKey(ctx, account.provider, handlerName);
}
