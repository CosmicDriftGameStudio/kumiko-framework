import type { SensitiveFilterConfig, SpanAttributeValue } from "./types/index.ts";

export const REDACTED = "[REDACTED]";

// Defaults are intentionally conservative — easier to add a header to the
// list than to explain a PII leak. All matching is case-insensitive.
export const DEFAULT_SENSITIVE_CONFIG: SensitiveFilterConfig = {
  redactedHeaders: ["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization"],
  redactedQueryParams: [
    "token",
    "access_token",
    "refresh_token",
    "password",
    "secret",
    "api_key",
    "apikey",
  ],
  redactedAttributeKeyPatterns: [
    /password/i,
    /secret/i,
    /token/i,
    /apikey/i,
    /privatekey/i,
    /credential/i,
    /session/i,
  ],
};

export function mergeSensitiveConfig(
  override: Partial<SensitiveFilterConfig> | undefined,
): SensitiveFilterConfig {
  if (!override) return DEFAULT_SENSITIVE_CONFIG;
  return {
    redactedHeaders: override.redactedHeaders ?? DEFAULT_SENSITIVE_CONFIG.redactedHeaders,
    redactedQueryParams:
      override.redactedQueryParams ?? DEFAULT_SENSITIVE_CONFIG.redactedQueryParams,
    redactedAttributeKeyPatterns:
      override.redactedAttributeKeyPatterns ??
      DEFAULT_SENSITIVE_CONFIG.redactedAttributeKeyPatterns,
  };
}

// Check a single attribute key against the redaction patterns.
// Used by the Span implementation when setAttribute is called.
export function shouldRedactAttribute(key: string, config: SensitiveFilterConfig): boolean {
  for (const pattern of config.redactedAttributeKeyPatterns) {
    if (pattern.test(key)) return true;
  }
  return false;
}

// Produce a type-preserving redacted value: numbers become 0, booleans become
// false, strings become "[REDACTED]". Keeps downstream consumers (exporters,
// dashboards) from having to deal with type drift — a histogram bucket that
// expected a number never suddenly sees a string.
export function redactValue(value: SpanAttributeValue): SpanAttributeValue {
  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  return REDACTED;
}

// Filter a full attribute map, replacing matching keys with a type-preserving
// redacted value.
export function redactAttributes(
  attrs: Readonly<Record<string, SpanAttributeValue>>,
  config: SensitiveFilterConfig,
): Record<string, SpanAttributeValue> {
  const out: Record<string, SpanAttributeValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    out[key] = shouldRedactAttribute(key, config) ? redactValue(value) : value;
  }
  return out;
}
