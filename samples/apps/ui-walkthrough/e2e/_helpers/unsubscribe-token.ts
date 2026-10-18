// @runtime test
// The Playwright worker cannot load the framework, so the spec signs its unsubscribe
// links itself: an HS256 JWT with the claims signUnsubscribeToken writes.

import { createHmac } from "node:crypto";
import { NORDLICHT_TENANT_ID, UNSUBSCRIBE_SECRET } from "../../src/app/auth-constants";

const ISSUER = "kumiko:unsubscribe";
const NOTIFICATION_TYPE = "billing:notify:invoice-issued";

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function signUnsubscribeLinkToken(options: {
  readonly locale: string;
  readonly subscriber?: string;
  readonly secondsValid?: number;
  readonly secret?: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256" }));
  const payload = base64Url(
    JSON.stringify({
      tenantId: NORDLICHT_TENANT_ID,
      notificationType: NOTIFICATION_TYPE,
      channel: "email",
      locale: options.locale,
      sub: options.subscriber ?? "e2e-subscriber",
      iss: ISSUER,
      iat: now - 60,
      exp: now + (options.secondsValid ?? 3600),
    }),
  );
  const signature = createHmac("sha256", options.secret ?? UNSUBSCRIBE_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}
