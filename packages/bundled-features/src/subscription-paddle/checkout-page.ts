// The Default Payment Link page. Paddle has no hosted checkout, so Paddle.js
// runs on this page and opens the overlay for the `?_ptxn=` transaction by
// itself. The page never reflects `_ptxn`.

import { createHash } from "node:crypto";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { escapeHtml } from "@cosmicdrift/kumiko-renderer/headless";
import type { Context } from "hono";
import * as z from "zod";
import type { SystemQueryFn } from "../shared/index.ts";
import { PADDLE_CHECKOUT_CONFIG_QUERY, PaddleEnvironments } from "./constants.ts";

const PADDLE_JS_URL = "https://cdn.paddle.com/paddle/v2/paddle.js";
const MAX_REDIRECT_LENGTH = 2048;
const FALLBACK_REDIRECT = "/";
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
// Control characters, which browsers strip or reinterpret inside URLs.
const CONTROL_CHARACTERS = /\p{Cc}/u;

// Static on purpose: its sha256 goes into the CSP, so nothing may be interpolated.
export const PADDLE_INIT_SCRIPT = `(function () {
  var data = document.getElementById("kumiko-paddle-checkout").dataset;
  var completed = false;
  if (data.environment === "sandbox") Paddle.Environment.set("sandbox");
  var settings = { displayMode: "overlay", successUrl: new URL(data.successUrl, location.origin).href };
  if (data.locale) settings.locale = data.locale;
  Paddle.Initialize({
    token: data.clientToken,
    checkout: { settings: settings },
    eventCallback: function (event) {
      if (event.name === "checkout.completed") completed = true;
      if (event.name === "checkout.closed" && !completed) {
        location.assign(new URL(data.cancelUrl, location.origin).href);
      }
    }
  });
})();`;

const INIT_SCRIPT_HASH = createHash("sha256").update(PADDLE_INIT_SCRIPT).digest("base64");

export const PADDLE_CHECKOUT_CSP = [
  "default-src 'none'",
  `script-src 'sha256-${INIT_SCRIPT_HASH}' https://cdn.paddle.com`,
  "style-src 'unsafe-inline' https://cdn.paddle.com",
  "img-src data: https://*.paddle.com",
  "connect-src https://*.paddle.com",
  "frame-src https://buy.paddle.com https://sandbox-buy.paddle.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

// Own header set: `securePageHeaders` pins `script-src 'none'`. The global
// wrapper only fills headers that are absent, so these win.
function pageHeaders(): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "content-security-policy": PADDLE_CHECKOUT_CSP,
  };
}

/** Same-origin path only: anything else would make the page an open redirector. */
export function safeRedirectPath(raw: string | undefined): string {
  if (
    raw === undefined ||
    raw.length > MAX_REDIRECT_LENGTH ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.startsWith("/\\") ||
    CONTROL_CHARACTERS.test(raw)
  ) {
    return FALLBACK_REDIRECT;
  }
  return raw;
}

export function safeLocale(raw: string | undefined): string | undefined {
  return raw !== undefined && LOCALE_PATTERN.test(raw) ? raw : undefined;
}

type CheckoutPageValues = {
  readonly clientToken: string;
  readonly environment: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly locale: string | undefined;
};

export function renderCheckoutPage(values: CheckoutPageValues): string {
  const attributesHtml = [
    ["data-client-token", values.clientToken],
    ["data-environment", values.environment],
    ["data-success-url", values.successUrl],
    ["data-cancel-url", values.cancelUrl],
    ...(values.locale ? [["data-locale", values.locale]] : []),
  ]
    .map(([name, value]) => `${name}="${escapeHtml(value ?? "")}"`)
    .join(" ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checkout</title>
</head>
<body>
<div id="kumiko-paddle-checkout" ${attributesHtml}></div>
<noscript>JavaScript is required to complete the checkout.</noscript>
<script src="${PADDLE_JS_URL}"></script>
<script>${PADDLE_INIT_SCRIPT}</script>
</body>
</html>
`;
}

const checkoutConfigSchema = z.object({
  clientToken: z.string().nullable(),
  environment: z.string(),
});

export async function servePaddleCheckoutPage(
  c: Context,
  { systemQuery }: { readonly systemQuery: SystemQueryFn },
): Promise<Response> {
  let config: z.infer<typeof checkoutConfigSchema>;
  try {
    config = checkoutConfigSchema.parse(
      await systemQuery(PADDLE_CHECKOUT_CONFIG_QUERY, {}, SYSTEM_TENANT_ID),
    );
  } catch {
    return unavailable(c);
  }
  if (!config.clientToken) return unavailable(c);
  const html = renderCheckoutPage({
    clientToken: config.clientToken,
    environment:
      config.environment === PaddleEnvironments.live
        ? PaddleEnvironments.live
        : PaddleEnvironments.sandbox,
    successUrl: safeRedirectPath(c.req.query("success")),
    cancelUrl: safeRedirectPath(c.req.query("cancel")),
    locale: safeLocale(c.req.query("locale")),
  });
  return new Response(html, { status: 200, headers: pageHeaders() });
}

function unavailable(c: Context): Response {
  return c.text("checkout unavailable", 503, { "cache-control": "no-store" });
}
