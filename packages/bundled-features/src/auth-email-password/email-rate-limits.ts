import type { PayloadRateLimitOption } from "@cosmicdrift/kumiko-types/handlers";

// The bucket counts across all IPs, so a long window would let an attacker who
// knows an address lock its owner out of recovery/signup for the whole window.
// A short one still throttles mail bombing but clears within minutes.
export const AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
export const AUTH_EMAIL_RATE_LIMIT_MAX_REQUESTS = 3;

export const AUTH_EMAIL_PAYLOAD_RATE_LIMITS: readonly PayloadRateLimitOption[] = [
  {
    per: { payloadField: "email" },
    limit: AUTH_EMAIL_RATE_LIMIT_MAX_REQUESTS,
    windowSeconds: AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS,
    normalize: "email",
  },
];
