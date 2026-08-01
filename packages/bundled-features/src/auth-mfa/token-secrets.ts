import { derivePurposeSecret } from "@cosmicdrift/kumiko-framework/secrets";

export type MfaTokenSecretOverrides = {
  readonly setupTokenSecret?: string;
  readonly challengeTokenSecret?: string;
};

export type ResolvedMfaTokenSecrets = {
  readonly setupTokenSecret: string;
  readonly challengeTokenSecret: string;
};

// The two HKDF purposes auth-mfa needs. They live here rather than at each
// call site because an app typically resolves them twice — once in the prod
// entrypoint against a validated JWT_SECRET, once in the dev server against
// its fallback — and a purpose string that drifts between those two files
// invalidates every token issued by the other.
//
// Setup and challenge stay separate on purpose: a setup token proves "this
// user is enrolling a factor", a challenge token proves "this user passed
// step one of login". Sharing one key would let the first be replayed as the
// second.
const SETUP_TOKEN_PURPOSE = "mfa-setup-token-v1";
const CHALLENGE_TOKEN_PURPOSE = "mfa-challenge-token-v1";

// A blank or whitespace-only override is treated as absent — an empty env
// var (MFA_SETUP_TOKEN_SECRET="") must fall back to derivation, not sign
// tokens with an empty/near-empty HMAC key (fw#1623).
function resolveSecret(override: string | undefined, fallback: () => string): string {
  return override !== undefined && override.trim() !== "" ? override : fallback();
}

/** Derives both MFA token secrets from the app's master secret. Pass explicit
 *  overrides only when a deployment needs its own key for one of them —
 *  otherwise deriving keeps a single env var authoritative. */
export function resolveMfaTokenSecrets(
  masterSecret: string,
  overrides: MfaTokenSecretOverrides = {},
): ResolvedMfaTokenSecrets {
  return {
    setupTokenSecret: resolveSecret(overrides.setupTokenSecret, () =>
      derivePurposeSecret(masterSecret, SETUP_TOKEN_PURPOSE),
    ),
    challengeTokenSecret: resolveSecret(overrides.challengeTokenSecret, () =>
      derivePurposeSecret(masterSecret, CHALLENGE_TOKEN_PURPOSE),
    ),
  };
}
