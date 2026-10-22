export const SUBSCRIPTION_DODO_FEATURE = "subscription-dodo" as const;

// Must match the path segment in the webhook URL `/api/subscription/webhook/dodo`.
export const DODO_PROVIDER_NAME = "dodo" as const;

// Config-key short-names, qualified to `subscription-dodo:config:<name>` at
// registry-build. api-key + webhook-secret are backing:"secrets".
export const DODO_API_KEY_CONFIG = "api-key" as const;
export const DODO_WEBHOOK_SECRET_CONFIG = "webhook-secret" as const;
export const DODO_BILLING_LIVE_CONFIG = "billingLive" as const;
export const DODO_ENVIRONMENT_CONFIG = "environment" as const;

// Separate from billingLive on purpose: staging runs Dodo's test API with
// billingLive on, production flips both.
export const DodoEnvironments = {
  test: "test",
  live: "live",
} as const;
export type DodoEnvironment = (typeof DodoEnvironments)[keyof typeof DodoEnvironments];

export const DODO_BASE_URLS: Readonly<Record<DodoEnvironment, string>> = {
  test: "https://test.dodopayments.com",
  live: "https://live.dodopayments.com",
};
