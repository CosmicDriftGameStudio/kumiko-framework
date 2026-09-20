export const PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "STRIPE_API_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "MOLLIE_API_KEY",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "PLATFORM_KEK_KMS_TOKEN",
] as const;

export function scrubProviderEnv(env: Record<string, string | undefined>): void {
  for (const key of PROVIDER_ENV_KEYS) delete env[key];
}
