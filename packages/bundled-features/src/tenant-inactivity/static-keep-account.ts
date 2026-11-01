// DOM-free "keep my account" page for static sites: fetch plus pure logic only.
// The link in the warning mail carries the token in the URL fragment (`#token=`), which browsers
// never send to a server or in a Referer.

import {
  dispatchWrite,
  type StaticRequestOptions,
  type StaticResult,
  staticSuccess,
  takeUrlToken,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/static-client";
import { TenantInactivityHandlers } from "./constants.ts";

export {
  hrefWithoutUrlToken,
  readUrlToken,
  STATIC_NETWORK_REASON,
  STATIC_RATE_LIMITED_REASON,
  type StaticFailure,
  type StaticRequestOptions,
  type StaticResult,
  type StaticSuccess,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/static-client";

/** Reads `#token=` from the current page and removes it from the address bar. Browser only. */
export function takeKeepAccountToken(): string {
  return takeUrlToken("fragment");
}

/** A used, replaced or expired link fails with reason `invalid_or_expired_token`. */
export async function keepAccount(
  token: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<undefined>> {
  const result = await dispatchWrite(TenantInactivityHandlers.keepAccount, { token }, options);
  return result.kind === "success" ? staticSuccess(undefined) : result;
}
