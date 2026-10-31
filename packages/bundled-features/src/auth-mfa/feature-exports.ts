import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { readFeatureExportFn } from "../shared/index.ts";
import type { MfaCodeVerifier } from "./mfa-code-verifier.ts";
import type { MfaStatusChecker } from "./mfa-status-checker.ts";
import type { MfaTokenSecretsEnv } from "./token-secrets.ts";

// Typed readers for what a mounted auth-mfa feature exposes on its untyped
// exports; the boot runners and other features wire through these.

export type BindMfaRevokeAllOtherSessions = (
  revoker: (userId: string, currentSid: string | undefined) => Promise<number>,
) => () => void;

// Reads the late-bind setter off a mounted auth-mfa feature's exports —
// mirrors sessions' own bindAutoRevokeFromFeature. run{Prod,Dev}App call
// this once the sessions feature (if mounted) has produced a concrete
// sessionRevokeAllOthers callback.
export function bindMfaRevokeAllOtherSessionsFromFeature(
  feature: FeatureDefinition,
): BindMfaRevokeAllOtherSessions | undefined {
  return readFeatureExportFn<BindMfaRevokeAllOtherSessions>(feature, "bindRevokeAllOtherSessions");
}

// Reads the eagerly-built `checkMfaStatus` off a mounted auth-mfa feature's
// exports — no bind-setter needed (see the comment where it's built).
export function mfaStatusCheckerFromFeature(
  feature: FeatureDefinition,
): MfaStatusChecker | undefined {
  return readFeatureExportFn<MfaStatusChecker>(feature, "checkMfaStatus");
}

// Reads the eagerly-built `verifyMfaCode` off a mounted auth-mfa feature's
// exports — personal-access-tokens wires this in as its optional
// mfaVerifier (re-auth gate for minting a token). Same no-bind-setter
// reasoning as checkMfaStatus above.
export function mfaVerifierFromFeature(feature: FeatureDefinition): MfaCodeVerifier | undefined {
  return readFeatureExportFn<MfaCodeVerifier>(feature, "verifyMfaCode");
}

export type BindMfaTokenSecrets = (masterSecret: string, env: MfaTokenSecretsEnv) => void;

// Reads the token-secret binder off a mounted auth-mfa feature's exports.
// run{Prod,Dev}App and setupTestStack call it with the JWT secret once the
// env is validated, so a dry run never needs the master secret.
export function bindMfaTokenSecretsFromFeature(
  feature: FeatureDefinition,
): BindMfaTokenSecrets | undefined {
  return readFeatureExportFn<BindMfaTokenSecrets>(feature, "bindTokenSecrets");
}

export type BindRevokeAllPatTokens = (revoker: (userId: string) => Promise<number>) => () => void;

// Reads the late-bind setter off a mounted auth-mfa feature's exports —
// run{Prod,Dev}App call this once the personal-access-tokens feature (if
// mounted) has produced a concrete revoker, same wiring shape as
// bindMfaRevokeAllOtherSessionsFromFeature.
export function bindRevokeAllPatTokensFromFeature(
  feature: FeatureDefinition,
): BindRevokeAllPatTokens | undefined {
  return readFeatureExportFn<BindRevokeAllPatTokens>(feature, "bindRevokeAllPatTokens");
}
