// kumiko-feature-version: 1
//
// Type contracts for auth-foundation's `tokenVerifier` extension point.
// Provider-features (future: auth-provider-jwt, auth-provider-pat) register
// an AuthProviderPlugin via `r.useExtension(EXT_TOKEN_VERIFIER, "<name>", plugin)`.
//
// **Shape-match routing:** unlike file-foundation/mail-foundation (one active
// provider per tenant, chosen via a config-key), token verification happens
// BEFORE the tenant is known — there's nothing to select on. Every registered
// provider declares a static `shape` (how to recognize its own tokens by
// looking at the raw bearer value); `resolveTokenVerifier` tries each
// provider's shape in turn and calls the first match's verifier.

import type {
  SessionChecker,
  SessionCreator,
  SessionRevoker,
} from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";

export const EXT_TOKEN_VERIFIER = "tokenVerifier";

/**
 * Deps available to a provider's `build()`. DB access only — a hot-path
 * resolver (see personal-access-tokens/resolver.ts) needs a raw-DB handle
 * for a point-read + live-role-resolution, not a per-request ctx (there is
 * no tenant/session yet at verify-time).
 */
export type AuthProviderBuildDeps = {
  readonly db: DbConnection;
};

/** How to recognize this provider's tokens by looking at the raw bearer value. */
export type TokenShape =
  | { readonly kind: "jwt" }
  | { readonly kind: "prefix"; readonly prefix: string };

export type AuthVerifier = (rawToken: string) => Promise<SessionUser | null>;

export type AuthProviderPlugin = {
  readonly shape: TokenShape;
  readonly build: (deps: AuthProviderBuildDeps) => Promise<AuthVerifier> | AuthVerifier;
};

export function isValidTokenShape(shape: unknown): shape is TokenShape {
  if (typeof shape !== "object" || shape === null || !("kind" in shape)) return false;
  const kind = (shape as { kind: unknown }).kind;
  if (kind === "jwt") return true;
  if (kind === "prefix") {
    const prefix = "prefix" in shape ? (shape as { prefix: unknown }).prefix : undefined;
    return typeof prefix === "string" && prefix.length > 0;
  }
  return false;
}

// extension-usage `options` is engine-payload (unknown) — structurally validate
// instead of casting blind. Mirrors file-foundation's isFileProviderPlugin.
export function isAuthProviderPlugin(o: unknown): o is AuthProviderPlugin {
  return (
    typeof o === "object" &&
    o !== null &&
    "build" in o &&
    typeof (o as { build: unknown }).build === "function" &&
    "shape" in o &&
    isValidTokenShape((o as { shape: unknown }).shape)
  );
}

export function tokenShapeMatches(shape: TokenShape, rawToken: string): boolean {
  if (shape.kind === "prefix") return rawToken.startsWith(shape.prefix);
  return rawToken.split(".").length === 3;
}

/** Static discriminator used by the multiplicity boot-check to detect two providers claiming the same shape. */
export function tokenShapeKey(shape: TokenShape): string {
  return shape.kind === "jwt" ? "jwt" : `prefix:${shape.prefix}`;
}

// Session-store extension point (#1370). Unlike EXT_TOKEN_VERIFIER, this is
// single-provider — sessions have no per-provider shape to route on, so
// exactly one implementation must be registered (boot-fails on 0 or ≥2).

export const EXT_SESSION_STORE = "sessionStore";

/** Mass-revoke every live session for a user. Used by password-change and "sign out everywhere". */
export type SessionMassRevoker = (userId: string) => Promise<number>;

export type SessionStore = {
  readonly creator: SessionCreator;
  readonly revoker: SessionRevoker;
  readonly checker: SessionChecker;
  readonly massRevoker: SessionMassRevoker;
};

export type SessionStoreProvider = {
  readonly build: (deps: AuthProviderBuildDeps) => Promise<SessionStore> | SessionStore;
};

export function isSessionStoreProvider(o: unknown): o is SessionStoreProvider {
  return (
    typeof o === "object" &&
    o !== null &&
    "build" in o &&
    typeof (o as { build: unknown }).build === "function"
  );
}
