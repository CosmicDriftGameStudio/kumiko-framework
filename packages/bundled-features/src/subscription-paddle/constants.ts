export const SUBSCRIPTION_PADDLE_FEATURE = "subscription-paddle" as const;

// Must match the last path segment of the webhook URL (`/webhooks/subscription/paddle` via the boot option).
export const PADDLE_PROVIDER_NAME = "paddle" as const;

// Paddle has no hosted checkout page, so the feature serves the Default Payment
// Link itself; the same path goes into the Paddle dashboard.
export const PADDLE_CHECKOUT_PATH = "/billing/paddle-checkout" as const;

// Config-key short-names, qualified to `subscription-paddle:config:<name>` at
// registry-build. api-key, webhook-secret and tenant-binding-key are backing:"secrets".
export const PADDLE_API_KEY_CONFIG = "api-key" as const;
export const PADDLE_WEBHOOK_SECRET_CONFIG = "webhook-secret" as const;
export const PADDLE_TENANT_BINDING_KEY_CONFIG = "tenant-binding-key" as const;
export const PADDLE_CLIENT_TOKEN_CONFIG = "client-token" as const;
export const PADDLE_ENVIRONMENT_CONFIG = "environment" as const;
export const PADDLE_BILLING_LIVE_CONFIG = "billingLive" as const;

export const PADDLE_CHECKOUT_CONFIG_QUERY = `${SUBSCRIPTION_PADDLE_FEATURE}:query:checkout-config`;

// Separate from billingLive on purpose: staging runs Paddle's sandbox with
// billingLive on, production flips both.
export const PaddleEnvironments = {
  sandbox: "sandbox",
  live: "live",
} as const;
export type PaddleEnvironment = (typeof PaddleEnvironments)[keyof typeof PaddleEnvironments];

export const PADDLE_BASE_URLS: Readonly<Record<PaddleEnvironment, string>> = {
  sandbox: "https://sandbox-api.paddle.com",
  live: "https://api.paddle.com",
};
