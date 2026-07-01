export const PAT_FEATURE = "personal-access-tokens";

// Only the first chars of a minted token are stored (alongside the hash) so the
// UI can show "kpat_ab12…" for recognition without ever holding the secret.
export const PAT_PREFIX_DISPLAY_LENGTH = 12;
