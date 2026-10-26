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
import type {
  InboundMailSupervisor,
  InboundMailSupervisorDeps,
  WatcherState,
  WatchLeaseResult,
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
      if (running) await ensureWatcher(account, plugin);
    }
  }

  async function pollOnce(): Promise<void> {
    const accounts = await listSyncableAccounts(systemDb, log);
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

  const syncAccountNow = createSyncAccountNow({
    inFlight: inFlightSyncs,
    loadAccount: async (accountId) => (await listSyncableAccounts(systemDb, log, accountId))[0],
    resolvePlugin: resolvePluginOrLog,
    pollAccount: pollAccountWithDeadline,
    ensureWatcher,
    isRunning: () => running,
  });

  // ---------------------------------------------------------------
  // Watch lifecycle with backoff restart.
  // ---------------------------------------------------------------
  // Heartbeat for a held watch lease. Independent of the connection's own
  // lifecycle — it keeps renewing across reconnect backoff, not just while
  // `plugin.watch()` is actually connected, so a flaky IMAP link doesn't
  // make this worker lose the account to a peer mid-backoff.
  function scheduleRenew(
    account: MailAccountRecord,
    state: WatcherState,
    generation: number,
  ): void {
    state.renewTimer = setTimeout(() => {
      void renewLeaseOnce(account, state, generation);
    }, renewIntervalMs);
  }

  async function tearDownAfterRenewFailures(
    account: MailAccountRecord,
    state: WatcherState,
    reason: string,
  ): Promise<void> {
    log(
      `inbound-mail: watch lease ${reason} for account ${account.id} — tearing down local watcher`,
    );
    state.lockToken = null;
    await stopWatcher(account.id);
  }

  async function renewLeaseOnce(
    account: MailAccountRecord,
    state: WatcherState,
    generation: number,
  ): Promise<void> {
    state.renewTimer = null;
    // skip: supervisor stopped, generation superseded, or lease already lost — stale timer fire, nothing to renew.
    if (!running || state.generation !== generation || !state.lockToken || !deps.lock) return;
    let renewed: boolean;
    try {
      renewed = await deps.lock.renew(account.id, state.lockToken, leaseTtlSeconds);
    } catch (err) {
      log(
        `inbound-mail: watch lease renew for account ${account.id} failed: ${describeError(err)}`,
      );
      state.renewFailures += 1;
      // After failures spanning a full lease TTL, tear down — otherwise a
      // peer can acquire the expired key while we still hold an IDLE conn.
      if (state.renewFailures * renewIntervalMs >= leaseTtlSeconds * 1000) {
        await tearDownAfterRenewFailures(account, state, "renew failed across TTL");
        // skip: connection torn down, no reschedule
        return;
      }
      rescheduleIfStillHeld(account, state, generation);
      // skip: renew failed but TTL not yet exhausted, retry already scheduled
      return;
    }
    state.renewFailures = 0;
    if (!renewed) {
      await tearDownAfterRenewFailures(account, state, "lost");
      // skip: lease lost and torn down, nothing to reschedule
      return;
    }
    rescheduleIfStillHeld(account, state, generation);
  }

  function rescheduleIfStillHeld(
    account: MailAccountRecord,
    state: WatcherState,
    generation: number,
  ): void {
    if (running && state.generation === generation && state.lockToken) {
      scheduleRenew(account, state, generation);
    }
  }

  // kumiko-lint-ignore complexity-budget yield-point stale-map check after acquire is intentional
  async function acquireWatchLease(
    account: MailAccountRecord,
    state: WatcherState,
  ): Promise<WatchLeaseResult> {
    if (!deps.lock || state.lockToken) return "acquired";
    const token = await deps.lock.acquire(account.id, { ttlSeconds: leaseTtlSeconds });
    if (!token) return "no-token";
    // The acquire() await is a yield point: a concurrent stopWatcher()
    // (e.g. from a lost-lease renewal on a different generation) may have
    // already retired this exact state and removed it from the map. If so,
    // committing the fresh token onto it would leak the lease — nothing
    // would ever release it, blocking failover for the full TTL.
    if (watchers.get(account.id) !== state) {
      await deps.lock.release(account.id, token);
      return "stale";
    }
    state.lockToken = token;
    scheduleRenew(account, state, state.generation);
    return "acquired";
  }

  // kumiko-lint-ignore complexity-budget watch lifecycle (start/stop/restart) stays cohesive
  async function ensureWatcher(
    account: MailAccountRecord,
    plugin: InboundMailProviderPlugin,
  ): Promise<void> {
    // skip: provider without live push; the reconciliation poll covers the account.
    if (!plugin.watch) return;
    await retireWatcherWithStaleTrust(account);
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

    const leaseResult = await acquireWatchLease(account, state);
    if (leaseResult === "no-token") {
      // Another worker already holds this account's watch lease — the poll
      // still covers it, this worker just doesn't open a second IDLE
      // connection. Retried on the next tick.
      if (!existing) watchers.delete(account.id);
      // skip: no lease token acquired above — nothing more to set up here.
      return;
    }
    if (leaseResult === "stale") {
      // skip: state was retired by a concurrent stopWatcher while acquire()
      // awaited — committing here would leak the lease.
      return;
    }

    const generation = state.generation;

    const scheduleRestart = (err: unknown) => {
      // skip: the supervisor stopped or the watcher generation changed; a restart
      // would create a zombie watcher.
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

    state.starting = true;
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
    } catch (err) {
      const keepRunning = await handleSyncError(account, err);
      if (keepRunning) scheduleRestart(err);
    } finally {
      state.starting = false;
    }
  }

  async function retireWatcherWithStaleTrust(account: MailAccountRecord): Promise<void> {
    const existing = watchers.get(account.id);
    if (existing?.stop && existing.trustedAuthservId !== (account.trustedAuthservId ?? null)) {
      await await stopWatcher(account.id);
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
      await Promise.allSettled([...inFlightSyncs.values()]);
      for (const accountId of [...watchers.keys()]) {
        await stopWatcher(accountId);
      }
    },
  };
}
