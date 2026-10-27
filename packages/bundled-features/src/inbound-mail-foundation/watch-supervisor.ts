// createInboundMailSupervisor — the long-lived Foundation sync process:
// starts `plugin.watch()` (IMAP IDLE, seconds-level push) for each active
// account with reconnect backoff, and also runs the periodic reconciliation
// poll (default: 5 min) through `plugin.fetch()`.
// Deduplication in the ingest handler makes watch/poll overlap idempotent:
// the poll is the correctness anchor, while watch only reduces latency.
//
// **Documented deviation:** the poll was originally intended as an `r.job`
// cron trigger. JobContext previously had no dispatcher (see
// run-export-jobs.ts), but now has one (`ctx.dispatch.write`/`ctx.dispatch.queryAs`,
// job-runner.ts). Converting the poll to a cron job is a separate migration
// because it changes the concurrency model, so this dispatcher contract
// remains in place. The app owner wires the supervisor in bin/server.ts:
//
//   const supervisor = createInboundMailSupervisor({
//     providerCtx: { registry: deps.registry, secrets, metricsFor: deps.metricsFor },
//     db,
//     dispatchWrite: ({ handlerQn, payload, tenantId }) =>
//       deps.dispatchSystemWrite({ handlerQn, payload, tenantId: tenantId as TenantId }),
//     // Multi-worker deployments: share one DistributedLock (same Redis,
//     // same key prefix) across every worker process so only one of them
//     // holds the IMAP IDLE connection per account. Omit `lock`
//     // for a single-process deployment — every active account gets
//     // watched locally, as before.
//     lock: createDistributedLock(redis, `${RedisKeys.lock}inbound-mail:watch:`),
//   });
//   await supervisor.start();
//   // shutdown-hook: await supervisor.stop();
//
// **IDLE operational risk:** long-lived sockets run in-process.
// Backoff restart on onError, clean shutdown of every watcher, and the poll
// covering every gap mitigate this risk.
//
// **Multi-worker coordination:** the reconciliation poll remains deliberately
// N-fold: every worker polls every active account, which is idempotent and
// cheap. Only `plugin.watch()` holds a long-lived connection, and only one
// worker may hold it per account. With `deps.lock`, `ensureWatcher` claims a
// TTL lease (`lock.acquire`) before connecting; a worker that fails to claim
// it leaves the account to its current holder, while the poll still covers
// it. The holder renews the lease via heartbeat (`lock.renew`, every ttl/3)
// for as long as the watcher state exists, including reconnect backoff, not
// only while the connection is open. Losing the claim (for example through
// a Redis outage or expired TTL) tears down the local watcher instead of
// racing a new holder.

import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  systemScopedRunner,
  tenantScopedSecrets,
} from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { mapWithConcurrency } from "../shared/index.ts";
import { createAccountHealth } from "./account-health.ts";
import { createAccountPoller } from "./account-poll.ts";
import { pollScheduleOf, withPollDeadline } from "./account-poll-schedule.ts";
import { registerMailAccountWakeListener } from "./account-wake.ts";
import { InboundMailAccountStatuses, InboundMailFoundationHandlers } from "./constants.ts";
import { describeError } from "./describe-error.ts";
import { currentCountBucket } from "./ingest-failures.ts";
import { createOAuthAccessTokenManager, usesFoundationManagedOAuth } from "./oauth-access-token.ts";
import {
  isInboundAuthError,
  isInboundCursorInvalidError,
  isInboundRateLimitError,
} from "./provider-errors.ts";
import { resolveInboundProviderForAccount } from "./provider-factory.ts";
import { createMessageIngester } from "./supervisor-ingest.ts";
import {
  createSyncAccountNow,
  type InFlightSyncs,
  runExclusivePerAccount,
} from "./sync-account-now.ts";
import { createSyncCursorStore } from "./sync-cursor-store.ts";
import { listSyncableAccounts, type SyncableAccount } from "./syncable-accounts.ts";
import type { InboundMailContext, InboundMailProviderPlugin, MailAccountRecord } from "./types.ts";
import { createWatchCatchUp } from "./watch-catch-up.ts";
import { createWatchLease } from "./watch-lease.ts";
import type {
  InboundMailSupervisor,
  InboundMailSupervisorDeps,
  WatcherState,
} from "./watch-supervisor-types.ts";

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BACKFILL_WINDOW_DAYS = 30;
const DEFAULT_MAX_MESSAGES_PER_POLL = 200;
const DEFAULT_WATCH_BACKOFF_INITIAL_MS = 5_000;
const DEFAULT_WATCH_BACKOFF_MAX_MS = 5 * 60 * 1000;
const DEFAULT_WATCH_LEASE_TTL_SECONDS = 90;

export function createInboundMailSupervisor(
  deps: InboundMailSupervisorDeps,
): InboundMailSupervisor {
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const backfillWindowDays = deps.backfillWindowDays ?? DEFAULT_BACKFILL_WINDOW_DAYS;
  const maxMessagesPerPoll = deps.maxMessagesPerPoll ?? DEFAULT_MAX_MESSAGES_PER_POLL;
  const { pollConcurrency, accountPollDeadlineMs } = pollScheduleOf(deps);
  const backoffInitialMs = deps.watchBackoffInitialMs ?? DEFAULT_WATCH_BACKOFF_INITIAL_MS;
  const backoffMaxMs = deps.watchBackoffMaxMs ?? DEFAULT_WATCH_BACKOFF_MAX_MS;
  const leaseTtlSeconds = deps.watchLeaseTtlSeconds ?? DEFAULT_WATCH_LEASE_TTL_SECONDS;
  // ttl/3 keeps at least two renewal attempts inside the TTL window before
  // it lapses. The 50ms floor only guards against a pathologically small
  // configured TTL — real deployments (default 90s) never hit it.
  const renewIntervalMs = Math.max(50, Math.floor((leaseTtlSeconds * 1000) / 3));
  const log = deps.log ?? (() => {});
  // The supervisor runs outside any request: secret reads need an audit
  // identity, and under enforced row-level security they need the account's
  // tenant scope, or the credential row is invisible and reads as missing.
  const providerCtx: InboundMailContext = {
    ...deps.providerCtx,
    auditUserId: deps.providerCtx.auditUserId ?? SYSTEM_USER_ID,
    ...(deps.providerCtx.secrets && { secrets: tenantScopedSecrets(deps.providerCtx.secrets) }),
  };
  const systemDb = systemScopedRunner(
    deps.db,
    "mail sync supervisor polls accounts and cursors of all tenants outside a request",
  );
  const oauthTokens =
    deps.oauthTokens ??
    (providerCtx.secrets
      ? createOAuthAccessTokenManager({
          db: systemDb,
          secrets: providerCtx.secrets,
          providerCtx,
        })
      : undefined);

  // Undefined for non-OAuth accounts. A refresh failure propagates into the
  // caller's handleSyncError: InboundAuthError → auth_error, anything else
  // → transient retry.
  async function resolveAccessToken(
    account: MailAccountRecord,
    plugin: InboundMailProviderPlugin,
  ): Promise<string | undefined> {
    if (!usesFoundationManagedOAuth(account, plugin)) return undefined;
    if (!oauthTokens) {
      throw new Error("oauth account needs a secrets context for token refresh");
    }
    return oauthTokens.getAccessToken(account, plugin);
  }

  let running = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollInFlight: Promise<void> | null = null;
  let unregisterWake: (() => void) | null = null;
  const watchers = new Map<string, WatcherState>();

  const cursors = createSyncCursorStore(systemDb);

  const ingester = createMessageIngester({
    db: systemDb,
    dispatchWrite: deps.dispatchWrite,
    log,
    ...(deps.storeBody && { storeBody: deps.storeBody }),
  });
  const health = createAccountHealth({ db: systemDb, dispatchWrite: deps.dispatchWrite, log });

  async function markAccount(
    account: MailAccountRecord,
    fields: { status?: string; watchState?: string },
    reason: string,
  ): Promise<void> {
    await deps.dispatchWrite({
      handlerQn: InboundMailFoundationHandlers.updateAccount,
      tenantId: account.tenantId,
      payload: { accountId: account.id, ...fields, reason },
    });
  }

  // ---------------------------------------------------------------
  // Error semantics, shared by poll and watch. Returns true when the
  // account may keep running.
  // ---------------------------------------------------------------
  async function handleSyncError(account: MailAccountRecord, err: unknown): Promise<boolean> {
    if (isInboundAuthError(err)) {
      log(`inbound-mail: account ${account.id} auth error — needs re-connect`);
      await stopWatcher(account.id);
      await markAccount(
        account,
        { status: InboundMailAccountStatuses.authError, watchState: "idle" },
        "watch_supervisor",
      );
      return false;
    }
    if (isInboundRateLimitError(err)) {
      log(`inbound-mail: account ${account.id} rate-limited (retryAfter ${err.retryAfterMs}ms)`);
      return true; // The next tick retries it
    }
    if (isInboundCursorInvalidError(err)) {
      log(`inbound-mail: account ${account.id} cursor invalid — full resync in backfill window`);
      await cursors.reset(account.id);
      return true;
    }
    // Transient or unknown error: log it and retry on the next tick.
    log(`inbound-mail: account ${account.id} sync error: ${describeError(err)}`);
    return true;
  }

  const { pollAccount } = createAccountPoller({
    systemDb,
    cursors,
    ingester,
    health,
    providerCtx,
    dispatchWrite: deps.dispatchWrite,
    backfillWindowDays,
    maxMessagesPerPoll,
    resolveAccessToken,
    handleSyncError,
    log,
  });

  function resolvePluginOrLog(account: SyncableAccount): InboundMailProviderPlugin | undefined {
    try {
      return resolveInboundProviderForAccount(providerCtx, account);
    } catch (err) {
      log(`inbound-mail: ${describeError(err)}`);
      return undefined;
    }
  }

  const inFlightSyncs: InFlightSyncs = new Map();

  const pollAccountWithDeadline = withPollDeadline(pollAccount, {
    ms: accountPollDeadlineMs,
    onDeadline: async (account) => {
      log(
        `inbound-mail: account ${account.id} sync passed its ${accountPollDeadlineMs}ms deadline`,
      );
      await health.onPollFailure(account, "transient");
    },
  });

  async function pollAccountOfTick(
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
  ): Promise<void> {
    // Joining would hang this tick on the same stuck sync; wake and syncAccountNow still join.
    if (inFlightSyncs.has(account.id)) {
      log(`inbound-mail: account ${account.id} is still syncing, skipped this tick`);
    } else {
      await runExclusivePerAccount(inFlightSyncs, account.id, async () => {
        await pollAccountWithDeadline(account, plugin, {
          countBucket: currentCountBucket(deps.now, pollIntervalMs),
        });
      });
    }
    if (running) await ensureWatcher(account, plugin);
  }

  async function pollOnce(): Promise<void> {
    const accounts = await listSyncableAccounts(systemDb, log, { health });
    // One account failing must not abort the others, and mapWithConcurrency would reject on the first error.
    await mapWithConcurrency(accounts, Math.max(1, pollConcurrency), async (account) => {
      try {
        const plugin = resolvePluginOrLog(account);
        if (plugin) await pollAccountOfTick(account, plugin);
      } catch (err) {
        log(`inbound-mail: account ${account.id} tick failed: ${describeError(err)}`);
      }
    });
    // Remove watchers for accounts that are no longer syncable.
    const syncableIds = new Set(accounts.map((a) => a.id));
    for (const accountId of watchers.keys()) {
      if (!syncableIds.has(accountId)) await stopWatcher(accountId);
    }
  }

  const watchCatchUp = createWatchCatchUp({
    inFlight: inFlightSyncs,
    pollAccount: pollAccountWithDeadline,
    isRunning: () => running,
    log,
  });

  const syncAccountNow = createSyncAccountNow({
    inFlight: inFlightSyncs,
    loadAccount: async (onlyAccountId) =>
      (await listSyncableAccounts(systemDb, log, { onlyAccountId }))[0],
    resolvePlugin: resolvePluginOrLog,
    pollAccount: pollAccountWithDeadline,
    ensureWatcher,
    isRunning: () => running,
  });

  // ---------------------------------------------------------------
  // Watch lifecycle with backoff restart.
  // ---------------------------------------------------------------
  const watchLease = createWatchLease({
    lock: deps.lock,
    ttlSeconds: leaseTtlSeconds,
    renewIntervalMs,
    watchers,
    isRunning: () => running,
    stopWatcher,
    log,
  });

  // kumiko-lint-ignore complexity-budget watch lifecycle (start/stop/restart) stays cohesive
  async function ensureWatcher(
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
  ): Promise<void> {
    // skip: provider without live push; the reconciliation poll covers the account.
    if (!plugin.watch) return;
    const stale = watchers.get(account.id);
    if (stale?.stop && stale.trustedAuthservId !== (account.trustedAuthservId ?? null)) {
      await stopWatcher(account.id);
    }
    const existing = watchers.get(account.id);
    // skip: the watcher is already running, starting, or scheduled for restart.
    if (existing?.stop || existing?.restartTimer || existing?.starting) return;

    const state: WatcherState = existing ?? {
      stop: null,
      backoffMs: backoffInitialMs,
      restartTimer: null,
      generation: 0,
      lockToken: null,
      renewTimer: null,
      renewFailures: 0,
      starting: false,
      trustedAuthservId: null,
    };
    watchers.set(account.id, state);
    state.starting = true;

    const leaseResult = await watchLease.acquire(account, state);
    if (leaseResult !== "acquired") {
      if (leaseResult === "no-token" && !existing) watchers.delete(account.id);
      state.starting = false;
      // skip: no-token means the poll still covers the account and the next tick retries; stale means stopWatcher retired this state.
      return;
    }

    const generation = state.generation;

    const scheduleRestart = (err: unknown) => {
      // skip: stopped or superseded generation; a restart would create a zombie watcher.
      if (!running || state.generation !== generation) return;
      state.stop = null;
      const delay = state.backoffMs;
      state.backoffMs = Math.min(state.backoffMs * 2, backoffMaxMs);
      log(
        `inbound-mail: watch for account ${account.id} died (${describeError(err)}) — restart in ${delay}ms`,
      );
      void markAccount(account, { watchState: `backoff:${delay}ms` }, "watch_supervisor");
      state.restartTimer = setTimeout(() => {
        state.restartTimer = null;
        void ensureWatcher(account, plugin);
      }, delay);
    };

    state.trustedAuthservId = account.trustedAuthservId ?? null;
    try {
      const accessToken = await resolveAccessToken(account, plugin);
      const stop = await plugin.watch(
        providerCtx,
        account,
        {
          onMessages: async (msgs) => {
            try {
              await ingester.ingestBatch(account, msgs, [], "watch");
            } catch (err) {
              // An ingest failure must not kill the watcher: the next poll
              // tick fetches the messages again and dedup keeps it idempotent.
              log(
                `inbound-mail: watch-ingest for account ${account.id} failed: ${describeError(err)}`,
              );
            }
          },
          onError: (err) => {
            void (async () => {
              const keepRunning = await handleSyncError(account, err);
              // On auth_error stopWatcher already bumped the generation, so
              // scheduleRestart is a no-op; every other error restarts with backoff.
              if (keepRunning) scheduleRestart(err);
            })();
          },
        },
        accessToken !== undefined ? { accessToken } : undefined,
      );
      if (state.generation !== generation || !running) {
        await stop();
        // skip: stop() ran while connecting; the watcher was torn down right away.
        return;
      }
      state.stop = stop;
      state.backoffMs = backoffInitialMs;
      // Await — fire-and-forget raced with a later auth_error mark under
      // try-first waitFor (isWatching true before projection settled). Own
      // try/catch: a projection-write hiccup here is not a sync failure —
      // the watch itself is healthy, so it must not trigger handleSyncError's
      // backoff/restart/auth_error handling below.
      try {
        await markAccount(account, { watchState: "watching" }, "watch_supervisor");
      } catch (err) {
        log(
          `inbound-mail: markAccount(watching) for account ${account.id} failed: ${describeError(err)}`,
        );
      }
      watchCatchUp.schedule(account, plugin);
    } catch (err) {
      const keepRunning = await handleSyncError(account, err);
      if (keepRunning) scheduleRestart(err);
    } finally {
      state.starting = false;
    }
  }

  async function stopWatcher(accountId: string): Promise<void> {
    const state = watchers.get(accountId);
    // skip: no watcher state for this account; it is already torn down.
    if (!state) return;
    state.generation += 1;
    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
      state.restartTimer = null;
    }
    if (state.renewTimer) {
      clearTimeout(state.renewTimer);
      state.renewTimer = null;
    }
    const stop = state.stop;
    state.stop = null;
    // Read the token before clearing it: only OUR claim gets released — a
    // caller that already cleared lockToken (lease-lost path in
    // scheduleRenew) means someone else may own it by now.
    const lockToken = state.lockToken;
    state.lockToken = null;
    watchers.delete(accountId);
    if (stop) {
      try {
        await stop();
      } catch (err) {
        log(`inbound-mail: stop watcher ${accountId} failed: ${describeError(err)}`);
      }
    }
    if (deps.lock && lockToken) {
      try {
        await deps.lock.release(accountId, lockToken);
      } catch (err) {
        log(
          `inbound-mail: watch lease release for account ${accountId} failed: ${describeError(err)}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------
  // Lifecycle.
  // ---------------------------------------------------------------
  function scheduleNextPoll(): void {
    // skip: the supervisor is stopped; do not schedule another poll tick.
    if (!running) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      pollInFlight = pollOnce()
        .catch((err) => log(`inbound-mail: poll tick failed: ${describeError(err)}`))
        .finally(() => {
          pollInFlight = null;
          scheduleNextPoll();
        });
    }, pollIntervalMs);
  }

  return {
    async start() {
      // skip: already started; start() is idempotent.
      if (running) return;
      running = true;
      unregisterWake = registerMailAccountWakeListener((_tenantId, accountId) => {
        syncAccountNow(accountId).catch((err) =>
          log(`inbound-mail: wake sync for account ${accountId} failed: ${describeError(err)}`),
        );
      });
      await pollOnce();
      scheduleNextPoll();
    },
    pollOnce,
    syncAccountNow,
    async stop() {
      running = false;
      unregisterWake?.();
      unregisterWake = null;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (pollInFlight) await pollInFlight;
      await Promise.allSettled([...inFlightSyncs.values(), watchCatchUp.settled()]);
      for (const accountId of [...watchers.keys()]) {
        await stopWatcher(accountId);
      }
    },
  };
}
