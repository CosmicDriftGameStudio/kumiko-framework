export const PAT_FEATURE = "personal-access-tokens";

export const PatHandlers = {
  create: "personal-access-tokens:write:create",
  revoke: "personal-access-tokens:write:revoke",
} as const;

export const PatQueries = {
  mine: "personal-access-tokens:query:mine",
  availableScopes: "personal-access-tokens:query:available-scopes",
} as const;

// Only the first chars of a minted token are stored (alongside the hash) so the
// UI can show "kpat_ab12…" for recognition without ever holding the secret.
export const PAT_PREFIX_DISPLAY_LENGTH = 12;

export type PatRateLimit = { readonly maxRequests: number; readonly windowMs: number };

// Default per-token request rate for PAT-authenticated calls. Generous enough
// for normal automation, low enough to blunt a leaked-token abuse spike.
export const PAT_DEFAULT_RATE_LIMIT: PatRateLimit = { maxRequests: 120, windowMs: 60_000 };
