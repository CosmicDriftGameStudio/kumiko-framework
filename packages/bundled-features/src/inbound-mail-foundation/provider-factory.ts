// Provider-Factory — Mirror von mail-foundation's createTransportForTenant
// inkl. der drei Fehlerpfade (kein registry / nicht registriert / falsche
// Plugin-Shape). Abweichung zum Outbound-Muster (Plan §1.3): KEIN
// per-Tenant-Config-Selector — der Provider steht pro MailAccount
// (`account.provider`), ein Tenant kann mehrere Provider parallel nutzen.

import { INBOUND_MAIL_FOUNDATION_FEATURE, INBOUND_MAIL_PROVIDER_EXTENSION } from "./constants";
import {
  type InboundMailContext,
  type InboundMailProviderPlugin,
  isInboundMailProviderPlugin,
  type MailAccountRecord,
} from "./types";

/** Lookup per Provider-Key ("imap", "m365-graph", ...) — genutzt von den
 *  OAuth-Connect-Routen, wo noch kein Account existiert. */
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

/** Lookup für einen konkreten Account — der Standard-Pfad in Poll-Job
 *  und Watch-Supervisor. */
export function resolveInboundProviderForAccount(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  handlerName = "inbound-mail-foundation:provider-factory",
): InboundMailProviderPlugin {
  return resolveInboundProviderForKey(ctx, account.provider, handlerName);
}
