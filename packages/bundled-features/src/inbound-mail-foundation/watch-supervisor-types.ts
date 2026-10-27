import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { DistributedLock } from "@cosmicdrift/kumiko-framework/pipeline";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { OAuthAccessTokenManager } from "./oauth-access-token.ts";
import type { InboundMailContext, MailAccountRecord, RawInboundMessage } from "./types.ts";

export type InboundMailSupervisorDeps = {
  /** Slim context for provider calls (`registry` is required; `secrets` is
   *  used for provider credential reads). */
  readonly providerCtx: InboundMailContext;
  /** App database — direct reads from read_mail_accounts (account snapshot)
   *  and direct writes to store_mail_sync_cursors (unmanaged store). */
  readonly db: DbConnection;
  /** Standard dispatcher with SystemUser — carries ingest-message and
   *  update-account. */
  readonly dispatchWrite: (args: {
    readonly handlerQn: string;
    readonly payload: unknown;
    readonly tenantId: string;
  }) => Promise<{
    readonly isSuccess: boolean;
    readonly data?: unknown;
    readonly error?: unknown;
  }>;
  /** Optional override for where the raw MIME original is stored. Without it the ingest handler
   *  stores original and attachments itself through the tenant's file provider
   *  (bodyRef = "" here lets it pick the deterministic key). */
  readonly storeBody?: (account: MailAccountRecord, msg: RawInboundMessage) => Promise<string>;
  readonly pollIntervalMs?: number;
  /** Clock for the failure-count bucket of a tick; tests inject a fake one. */
  readonly now?: () => Temporal.Instant;
  readonly backfillWindowDays?: number;
  readonly maxMessagesPerPoll?: number;
  /** Accounts synced side by side within one tick. Default 4. */
  readonly pollConcurrency?: number;
  /** Longest a single account's sync may run before the supervisor abandons it as a failed poll.
   *  Default 10 minutes. */
  readonly accountPollDeadlineMs?: number;
  readonly watchBackoffInitialMs?: number;
  readonly watchBackoffMaxMs?: number;
  /** Coordinates the IMAP watch (not the poll) across worker processes:
   *  before `plugin.watch()`, ensureWatcher claims a TTL lease for the
   *  account via `lock.acquire` and renews it via `lock.renew` while the
   *  watcher lives. Omit for single-process deployments — every active
   *  account is watched locally, same as before. */
  readonly lock?: DistributedLock;
  /** Access-token lifecycle for OAuth accounts. Defaults to a manager built
   *  from `db` + `providerCtx.secrets`; pass the instance shared with
   *  `createInboundMailConnectRoutes` so a fresh connect primes this cache. */
  readonly oauthTokens?: OAuthAccessTokenManager;
  /** TTL (seconds) for the per-account watch lease. Default 90s, renewed
   *  every ttl/3. Only used when `lock` is set. */
  readonly watchLeaseTtlSeconds?: number;
  readonly log?: (line: string) => void;
};

export type WatcherState = {
  stop: (() => Promise<void>) | null;
  backoffMs: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  /** Incremented by stop() to prevent a delayed restart from reviving
   *  an already stopped watcher. */
  generation: number;
  /** Token from `deps.lock.acquire` while this worker owns the account's
   *  watch lease; null when unclaimed (no `deps.lock`, or claim lost). */
  lockToken: string | null;
  renewTimer: ReturnType<typeof setTimeout> | null;
  /** Consecutive renew() throws — tear down once failures span a full TTL. */
  renewFailures: number;
  /** True while plugin.watch() is in flight (re-entrancy guard). */
  starting: boolean;
  /** The provider reads the account it was handed at watch start; a changed trust setting
   *  only reaches it through a fresh watch. */
  trustedAuthservId: string | null;
};

export type WatchLeaseResult = "acquired" | "no-token" | "stale";

export type InboundMailSupervisor = {
  readonly start: () => Promise<void>;
  /** Reconciliation run across all active accounts; also usable standalone
   *  for tests and manual operational triggers. */
  readonly pollOnce: () => Promise<void>;
  /** Syncs one account immediately (connect/reconnect wake-up); joins a sync already running for it. */
  readonly syncAccountNow: (accountId: string) => Promise<void>;
  readonly stop: () => Promise<void>;
};
