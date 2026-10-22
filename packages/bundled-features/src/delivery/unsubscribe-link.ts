import { publicOriginOf } from "@cosmicdrift/kumiko-framework/api";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { hashUnsubscribeAddress } from "./address-opt-out.ts";
import { DELIVERY_UNSUBSCRIBE_PATH } from "./constants.ts";
import type { ChannelContext } from "./types.ts";
import { signAddressUnsubscribeToken, signUnsubscribeToken } from "./unsubscribe.ts";

/** Secret shared with `createUnsubscribeRoutes` plus the public origin the links point at. */
export type UnsubscribeLinkConfig = {
  readonly secret: string;
  readonly baseUrl: string;
  /** The sending tenant's own public origin (subdomain or custom domain), null when it has
   *  none. The host must serve this app's `/api` routes, and the callback must only return a
   *  verified, active domain of the tenant (the check that lets the app serve under it), else null:
   *  the link carries a bearer token that unsubscribes and yields a resubscribe token. Null, a throw or an unusable value
   *  fall back to `baseUrl`, so a missing tenant origin never fails a send. */
  readonly tenantOrigin?: (ctx: ChannelContext) => Promise<string | null | undefined>;
};

export type UnsubscribeLinkRecipient =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "address"; readonly address: string };

// https only, unless the app itself runs on plain http (local dev): a tenant origin must not
// downgrade the link that carries the token.
function isUsableTenantOrigin(origin: string, baseUrl: string): boolean {
  return (
    origin.startsWith("https://") || (baseUrl.startsWith("http://") && origin.startsWith("http://"))
  );
}

export async function unsubscribeLinkOrigin(
  config: UnsubscribeLinkConfig,
  ctx: ChannelContext,
  onFallback: (reason: string) => void,
): Promise<string> {
  if (config.tenantOrigin === undefined) return config.baseUrl;
  let resolved: string | null | undefined;
  try {
    resolved = await config.tenantOrigin(ctx);
  } catch (err) {
    onFallback(`tenantOrigin threw (${err instanceof Error ? err.name : typeof err})`);
    return config.baseUrl;
  }
  if (resolved === null || resolved === undefined) return config.baseUrl;
  const origin = publicOriginOf(resolved);
  if (origin === undefined || !isUsableTenantOrigin(origin, config.baseUrl)) {
    onFallback("tenantOrigin returned no usable https origin");
    return config.baseUrl;
  }
  return origin;
}

// Undefined means "no link": without a blind-index key an address opt-out could never be
// matched again, and a mail without a link is better than a failed send.
export async function buildUnsubscribeUrl(
  config: UnsubscribeLinkConfig,
  origin: string,
  recipient: UnsubscribeLinkRecipient,
  scope: {
    tenantId: TenantId;
    notificationType: string;
    channel: string;
    locale: string | undefined;
  },
): Promise<string | undefined> {
  if (recipient.kind === "address" && hashUnsubscribeAddress(recipient.address) === undefined) {
    return undefined;
  }
  const token =
    recipient.kind === "user"
      ? await signUnsubscribeToken({ ...scope, userId: recipient.userId }, config.secret)
      : await signAddressUnsubscribeToken({ ...scope, address: recipient.address }, config.secret);
  return `${origin}${DELIVERY_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}
