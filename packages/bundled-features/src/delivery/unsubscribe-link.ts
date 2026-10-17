import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { hashUnsubscribeAddress } from "./address-opt-out.js";
import { DELIVERY_UNSUBSCRIBE_PATH } from "./constants.js";
import { signAddressUnsubscribeToken, signUnsubscribeToken } from "./unsubscribe.js";

/** Secret shared with `createUnsubscribeRoutes` plus the public origin the links point at. */
export type UnsubscribeLinkConfig = {
  readonly secret: string;
  readonly baseUrl: string;
};

export type UnsubscribeLinkRecipient =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "address"; readonly address: string };

// Undefined means "no link": without a blind-index key an address opt-out could never be
// matched again, and a mail without a link is better than a failed send.
export async function buildUnsubscribeUrl(
  config: UnsubscribeLinkConfig,
  recipient: UnsubscribeLinkRecipient,
  scope: { tenantId: TenantId; notificationType: string; channel: string },
): Promise<string | undefined> {
  if (recipient.kind === "address" && hashUnsubscribeAddress(recipient.address) === undefined) {
    return undefined;
  }
  const token =
    recipient.kind === "user"
      ? await signUnsubscribeToken({ ...scope, userId: recipient.userId }, config.secret)
      : await signAddressUnsubscribeToken({ ...scope, address: recipient.address }, config.secret);
  return `${config.baseUrl}${DELIVERY_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}
