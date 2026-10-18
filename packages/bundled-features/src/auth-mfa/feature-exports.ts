import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { MfaCodeVerifier } from "./mfa-code-verifier.ts";
import type { MfaStatusChecker } from "./mfa-status-checker.ts";
import type { MfaTokenSecretsEnv } from "./token-secrets.ts";

// Typed readers for what a mounted auth-mfa feature exposes on its untyped
// exports; the boot runners and other features wire through these.

export type BindMfaRevokeAllOtherSessions = (
  revoker: (userId: string, currentSid: string | undefined) => Promise<number>,
) => void;

// Reads the late-bind setter off a mounted auth-mfa feature's exports —
// mirrors sessions' own bindAutoRevokeFromFeature. run{Prod,Dev}App call
// this once the sessions feature (if mounted) has produced a concrete
// sessionRevokeAllOthers callback.
export function bindMfaRevokeAllOtherSessionsFromFeature(
  feature: FeatureDefinition,
): BindMfaRevokeAllOtherSessions | undefined {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "bindRevokeAllOtherSessions" in exports) {
    const { bindRevokeAllOtherSessions } = exports;
    if (typeof bindRevokeAllOtherSessions === "function") {
      // @cast-boundary feature-exports — feature.exports is untyped by design
      return bindRevokeAllOtherSessions as BindMfaRevokeAllOtherSessions;
    }
  }
  return undefined;
}

// Reads the eagerly-built `checkMfaStatus` off a mounted auth-mfa feature's
// exports — no bind-setter needed (see the comment where it's built).
export function mfaStatusCheckerFromFeature(
  feature: FeatureDefinition,
): MfaStatusChecker | undefined {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "checkMfaStatus" in exports) {
    const { checkMfaStatus } = exports;
    if (typeof checkMfaStatus === "function") {
      // @cast-boundary feature-exports — feature.exports is untyped by design
      return checkMfaStatus as MfaStatusChecker;
    }
  }
  return undefined;
}

// Reads the eagerly-built `verifyMfaCode` off a mounted auth-mfa feature's
// exports — personal-access-tokens wires this in as its optional
// mfaVerifier (re-auth gate for minting a token). Same no-bind-setter
// reasoning as checkMfaStatus above.
export function mfaVerifierFromFeature(feature: FeatureDefinition): MfaCodeVerifier | undefined {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "verifyMfaCode" in exports) {
    const { verifyMfaCode } = exports;
    if (typeof verifyMfaCode === "function") {
      // @cast-boundary feature-exports — feature.exports is untyped by design
      return verifyMfaCode as MfaCodeVerifier;
    }
  }
  return undefined;
}

export type BindMfaTokenSecrets = (masterSecret: string, env: MfaTokenSecretsEnv) => void;

// Reads the token-secret binder off a mounted auth-mfa feature's exports.
// run{Prod,Dev}App and setupTestStack call it with the JWT secret once the
// env is validated, so a dry run never needs the master secret.
export function bindMfaTokenSecretsFromFeature(
  feature: FeatureDefinition,
): BindMfaTokenSecrets | undefined {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "bindTokenSecrets" in exports) {
    const { bindTokenSecrets } = exports;
    if (typeof bindTokenSecrets === "function") {
      // @cast-boundary feature-exports — feature.exports is untyped by design
      return bindTokenSecrets as BindMfaTokenSecrets;
    }
  }
  return undefined;
}

export type BindRevokeAllPatTokens = (revoker: (userId: string) => Promise<number>) => void;

// Reads the late-bind setter off a mounted auth-mfa feature's exports —
// run{Prod,Dev}App call this once the personal-access-tokens feature (if
// mounted) has produced a concrete revoker, same wiring shape as
// bindMfaRevokeAllOtherSessionsFromFeature.
export function bindRevokeAllPatTokensFromFeature(
  feature: FeatureDefinition,
): BindRevokeAllPatTokens | undefined {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "bindRevokeAllPatTokens" in exports) {
    const { bindRevokeAllPatTokens } = exports;
    if (typeof bindRevokeAllPatTokens === "function") {
      // @cast-boundary feature-exports — feature.exports is untyped by design
      return bindRevokeAllPatTokens as BindRevokeAllPatTokens;
    }
  }
  return undefined;
}
