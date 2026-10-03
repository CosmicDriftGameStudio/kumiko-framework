// OAuth access-token lifecycle for inbound-mail accounts. Access tokens
// (~1h) are never persisted: they live in a per-process cache and are
// re-minted from the refresh token in the account's secret slot.
//
// Serialization:
//   - in-process: single-flight per account (concurrent callers share one
//     refresh).
//   - cross-worker: a pg advisory xact lock around "re-read refresh token →
//     provider refresh → persist rotated refresh token". This serializes
//     refreshes and secret writes so a rotating provider can't see two
//     workers redeem the same refresh token concurrently. It does NOT make
//     refresh exactly-once across workers: access tokens are per-process, so
//     each worker still refreshes once itself.
//
// The refresh token is re-read inside the lock via `secrets.get` without an
// audit context. SecretsContext does not cache values (only unwrapped DEKs),
// so the read always reflects the latest committed write.

import { transaction } from "@cosmicdrift/kumiko-framework/bun-db";
import { acquireNamespacedAdvisoryLock, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { Temporal } from "temporal-polyfill";
import { InboundMailAuthMethods, inboundCredentialSecretKey } from "./constants.js";
import {
  InboundAuthError,
  type InboundMailContext,
  type InboundMailProviderPlugin,
  type MailAccountRecord,
  type OAuthTokenSet,
} from "./types.js";

// 'inoa' as ASCII — disjoint from the other fixed advisory-lock namespaces.
const OAUTH_REFRESH_LOCK_NAMESPACE = 0x696e6f61;
const ACCESS_TOKEN_EXPIRY_MARGIN = Temporal.Duration.from({ minutes: 2 });
// The provider call runs while the lock transaction holds a pool connection,
// so it gets an abort signal with this upper bound.
const DEFAULT_REFRESH_TIMEOUT_MS = 30_000;

/** Shared by the OAuth callback and the refresh path so both write the slot identically. */
export function inboundRefreshTokenSecretOptions(accountId: string) {
  return {
    redact: (plaintext: string) => `${plaintext.slice(0, 4)}…`,
    hint: `OAuth refresh token for inbound mail account ${accountId}`,
  };
}

/** True for accounts whose access token the foundation must supply. */
export function usesFoundationManagedOAuth(
  account: MailAccountRecord,
  plugin: InboundMailProviderPlugin,
): boolean {
  return (
    plugin.oauth !== undefined &&
    (account.authMethod === InboundMailAuthMethods.oauth ||
      account.authMethod === InboundMailAuthMethods.xoauth2)
  );
}

export type OAuthAccessTokenManagerDeps = {
  readonly db: DbConnection;
  readonly secrets: SecretsContext;
  readonly providerCtx?: InboundMailContext;
  readonly now?: () => Temporal.Instant;
  readonly refreshTimeoutMs?: number;
};

export type OAuthAccessTokenManager = {
  /** Valid access token for the account; refreshes when missing or near expiry. */
  readonly getAccessToken: (
    account: MailAccountRecord,
    plugin: InboundMailProviderPlugin,
  ) => Promise<string>;
  /** Writes the refresh token under the account lock and drops any cached access token. */
  readonly storeRefreshToken: (
    account: Pick<MailAccountRecord, "id" | "tenantId">,
    refreshToken: string,
  ) => Promise<void>;
  /** Seeds the cache from a code-exchange result (access token only). */
  readonly primeFromExchange: (
    account: Pick<MailAccountRecord, "id">,
    tokens: OAuthTokenSet,
  ) => void;
  readonly invalidate: (accountId: string) => void;
};

type CachedToken = { readonly accessToken: string; readonly expiresAt: Temporal.Instant };

function lockKey(account: Pick<MailAccountRecord, "id" | "tenantId">): string {
  return `${account.tenantId}:${account.id}`;
}

export function createOAuthAccessTokenManager(
  deps: OAuthAccessTokenManagerDeps,
): OAuthAccessTokenManager {
  const now = deps.now ?? (() => Temporal.Now.instant());
  const refreshTimeoutMs = deps.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS;
  const providerCtx: InboundMailContext = { ...deps.providerCtx, secrets: deps.secrets };
  const cache = new Map<string, CachedToken>();
  const inFlight = new Map<string, Promise<string>>();

  function parseExpiry(iso: string): Temporal.Instant {
    try {
      return Temporal.Instant.from(iso);
    } catch {
      // Unparseable expiry: treat as already expired so it is never cached.
      return now();
    }
  }

  function remember(accountId: string, tokens: OAuthTokenSet): void {
    cache.set(accountId, {
      accessToken: tokens.accessToken,
      expiresAt: parseExpiry(tokens.expiresAt),
    });
  }

  function cachedValid(accountId: string): string | undefined {
    const hit = cache.get(accountId);
    if (!hit) return undefined;
    const usableUntil = hit.expiresAt.subtract(ACCESS_TOKEN_EXPIRY_MARGIN);
    return Temporal.Instant.compare(now(), usableUntil) < 0 ? hit.accessToken : undefined;
  }

  async function refreshWithTimeout(
    plugin: InboundMailProviderPlugin,
    account: MailAccountRecord,
    refreshToken: string,
  ): Promise<OAuthTokenSet> {
    const oauth = plugin.oauth;
    if (!oauth) throw new InboundAuthError("provider has no oauth flow");
    return oauth.refreshAccessToken(providerCtx, account, refreshToken, {
      signal: AbortSignal.timeout(refreshTimeoutMs),
    });
  }

  async function refresh(
    account: MailAccountRecord,
    plugin: InboundMailProviderPlugin,
  ): Promise<string> {
    const secretKey = inboundCredentialSecretKey(account.id);
    return transaction(deps.db, async (tx) => {
      await acquireNamespacedAdvisoryLock(tx, OAUTH_REFRESH_LOCK_NAMESPACE, lockKey(account));
      const stored = await deps.secrets.get(account.tenantId, secretKey);
      if (!stored) {
        throw new InboundAuthError("no refresh token stored for account");
      }
      const currentRefreshToken = stored.reveal();
      const tokens = await refreshWithTimeout(plugin, account, currentRefreshToken);
      if (tokens.refreshToken && tokens.refreshToken !== currentRefreshToken) {
        await deps.secrets.set(
          account.tenantId,
          secretKey,
          tokens.refreshToken,
          inboundRefreshTokenSecretOptions(account.id),
        );
      }
      remember(account.id, tokens);
      return tokens.accessToken;
    });
  }

  return {
    async getAccessToken(account, plugin) {
      const hit = cachedValid(account.id);
      if (hit !== undefined) return hit;
      const running = inFlight.get(account.id);
      if (running) return running;
      const started = refresh(account, plugin)
        .catch((err: unknown) => {
          cache.delete(account.id);
          throw err;
        })
        .finally(() => {
          inFlight.delete(account.id);
        });
      inFlight.set(account.id, started);
      return started;
    },

    async storeRefreshToken(account, refreshToken) {
      await transaction(deps.db, async (tx) => {
        await acquireNamespacedAdvisoryLock(tx, OAUTH_REFRESH_LOCK_NAMESPACE, lockKey(account));
        await deps.secrets.set(
          account.tenantId,
          inboundCredentialSecretKey(account.id),
          refreshToken,
          inboundRefreshTokenSecretOptions(account.id),
        );
      });
      cache.delete(account.id);
    },

    primeFromExchange(account, tokens) {
      remember(account.id, tokens);
    },

    invalidate(accountId) {
      cache.delete(accountId);
    },
  };
}
