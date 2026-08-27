// createInboundMailSupervisor — der langlebige Sync-Prozess der
// Foundation: startet pro aktivem Account `plugin.watch()` (IMAP IDLE,
// Push in Sekunden) mit Reconnect-Backoff und fährt zusätzlich den
// periodischen Reconciliation-Poll (Default 5 min) über `plugin.fetch()`.
// Dedup im ingest-Handler macht Watch/Poll-Überschneidung idempotent —
// der Poll ist Korrektheits-Anker, watch nur Latenz-Optimierung.
//
// **Plan deviation (documented):** the plan had the poll as an `r.job`
// cron trigger. At the time this was written, JobContext had no
// dispatcher (verified against run-export-jobs.ts). It now does
// (`ctx.write`/`ctx.queryAs`, job-runner.ts) — but converting the poll to
// a cron job is a separate migration (job concurrency instead of this
// dispatcher contract), not part of #1719, and stays untouched here. The
// app owner still wires the supervisor in bin/server.ts:
//
//   const supervisor = createInboundMailSupervisor({
//     providerCtx: { registry: deps.registry, secrets },
//     db,
//     dispatchWrite: ({ handlerQn, payload, tenantId }) =>
//       deps.dispatchSystemWrite({ handlerQn, payload, tenantId: tenantId as TenantId }),
//     // Multi-worker deployments: share one DistributedLock (same Redis,
//     // same key prefix) across every worker process so only one of them
//     // holds the IMAP IDLE connection per account (#1719). Omit `lock`
//     // for a single-process deployment — every active account gets
//     // watched locally, same as before.
//     lock: createDistributedLock(redis, `${RedisKeys.lock}inbound-mail:watch:`),
//   });
//   await supervisor.start();
//   // shutdown-hook: await supervisor.stop();
//
// **IDLE operational risk (plan §7.3):** long-lived sockets in-process.
// Mitigated here via backoff-restart on onError, a clean stop() of every
// watcher on shutdown, and the poll covering every gap.
//
// **Multi-worker coordination (#1719):** the reconciliation poll stays
// deliberately N-fold — every worker polls every active account, which
// is idempotent and cheap. Only `plugin.watch()` holds a long-lived
// connection, and only one worker may hold it per account. With
// `deps.lock`, `ensureWatcher` claims a TTL lease (`lock.acquire`) for
// the account before connecting; a worker that doesn't get it leaves the
// account to its current holder — the poll still covers it. The holder
// renews the claim via heartbeat (`lock.renew`, every ttl/3) for as long
// as the watcher state lives, including across reconnect backoff, not
// only while the connection is open. Losing the claim (Redis outage, TTL
// exceeded) tears down the local watcher instead of racing a new holder.

import { fetchOne, insertOne, selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection, EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type { DistributedLock } from "@cosmicdrift/kumiko-framework/pipeline";
import { Temporal } from "temporal-polyfill";
import { InboundMailAccountStatuses, InboundMailFoundationHandlers } from "./constants";
import { MAIL_ACCOUNT_PII_FIELDS, syncCursorTable } from "./entities";
import { mailAccountsProjectionTable } from "./projection";
import { resolveInboundProviderForAccount } from "./provider-factory";
import {
  type InboundMailContext,
  type InboundMailProviderPlugin,
  isInboundAuthError,
  isInboundCursorInvalidError,
  isInboundRateLimitError,
  type MailAccountRecord,
  type RawInboundMessage,
  type SyncCursorPayload,
} from "./types";

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BACKFILL_WINDOW_DAYS = 30;
const DEFAULT_MAX_MESSAGES_PER_POLL = 200;
const DEFAULT_WATCH_BACKOFF_INITIAL_MS = 5_000;
const DEFAULT_WATCH_BACKOFF_MAX_MS = 5 * 60 * 1000;
const DEFAULT_WATCH_LEASE_TTL_SECONDS = 90;
/** V1: ein Cursor pro Account (eine Mailbox-Inbox). Multi-Folder später
 *  über weitere scopes ohne Schema-Änderung. */
const CURSOR_SCOPE = "default";

export type InboundMailSupervisorDeps = {
  /** Slim-Context für Provider-Calls (registry Pflicht, secrets für
   *  Credential-Reads der Provider). */
  readonly providerCtx: InboundMailContext;
  /** App-DB — direct reads auf read_mail_accounts (Account-Snapshot)
   *  + direct writes auf store_mail_sync_cursors (unmanaged store). */
  readonly db: DbConnection;
  /** Standard-Dispatcher mit SystemUser — trägt ingest-message +
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
  /** Persisted den raw MIME-Body (file-foundation) und liefert den
   *  bodyRef fürs Event. Fehlt der Hook, läuft snippet-only-Mode
   *  (bodyRef = ""). */
  readonly storeBody?: (account: MailAccountRecord, msg: RawInboundMessage) => Promise<string>;
  readonly pollIntervalMs?: number;
  readonly backfillWindowDays?: number;
  readonly maxMessagesPerPoll?: number;
  readonly watchBackoffInitialMs?: number;
  readonly watchBackoffMaxMs?: number;
  /** Coordinates the IMAP watch (not the poll) across worker processes:
   *  before `plugin.watch()`, ensureWatcher claims a TTL lease for the
   *  account via `lock.acquire` and renews it via `lock.renew` while the
   *  watcher lives. Omit for single-process deployments — every active
   *  account is watched locally, same as before #1719. */
  readonly lock?: DistributedLock;
  /** TTL (seconds) for the per-account watch lease. Default 90s, renewed
   *  every ttl/3. Only used when `lock` is set. */
  readonly watchLeaseTtlSeconds?: number;
  readonly log?: (line: string) => void;
};

type WatcherState = {
  stop: (() => Promise<void>) | null;
  backoffMs: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  /** Bump beim stop() — verhindert dass ein nachzügelnder Restart einen
   *  bereits gestoppten Watcher wiederbelebt. */
  generation: number;
  /** Token from `deps.lock.acquire` while this worker owns the account's
   *  watch lease; null when unclaimed (no `deps.lock`, or claim lost). */
  lockToken: string | null;
  renewTimer: ReturnType<typeof setTimeout> | null;
  /** Consecutive renew() throws — tear down once failures span a full TTL. */
  renewFailures: number;
  /** True while plugin.watch() is in flight (re-entrancy guard). */
  starting: boolean;
};

type WatchLeaseResult = "acquired" | "no-token" | "stale";

export type InboundMailSupervisor = {
  readonly start: () => Promise<void>;
  /** Ein Reconciliation-Durchlauf über alle aktiven Accounts — auch
   *  standalone nutzbar (Tests, manueller Ops-Trigger). */
  readonly pollOnce: () => Promise<void>;
  readonly stop: () => Promise<void>;
};

export function createInboundMailSupervisor(
  deps: InboundMailSupervisorDeps,
): InboundMailSupervisor {
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const backfillWindowDays = deps.backfillWindowDays ?? DEFAULT_BACKFILL_WINDOW_DAYS;
  const maxMessagesPerPoll = deps.maxMessagesPerPoll ?? DEFAULT_MAX_MESSAGES_PER_POLL;
  const backoffInitialMs = deps.watchBackoffInitialMs ?? DEFAULT_WATCH_BACKOFF_INITIAL_MS;
  const backoffMaxMs = deps.watchBackoffMaxMs ?? DEFAULT_WATCH_BACKOFF_MAX_MS;
  const leaseTtlSeconds = deps.watchLeaseTtlSeconds ?? DEFAULT_WATCH_LEASE_TTL_SECONDS;
  // ttl/3 keeps at least two renewal attempts inside the TTL window before
  // it lapses. The 50ms floor only guards against a pathologically small
  // configured TTL — real deployments (default 90s) never hit it.
  const renewIntervalMs = Math.max(50, Math.floor((leaseTtlSeconds * 1000) / 3));
  const log = deps.log ?? (() => {});

  let running = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollInFlight: Promise<void> | null = null;
  const watchers = new Map<string, WatcherState>();

  // ---------------------------------------------------------------
  // Account-Snapshot: aktive Accounts aller Tenants, address decrypted
  // (Provider arbeiten nie mit Ciphertext).
  // ---------------------------------------------------------------
  async function listActiveAccounts(): Promise<readonly MailAccountRecord[]> {
    const rows = await selectMany(deps.db, mailAccountsProjectionTable, {
      status: InboundMailAccountStatuses.active,
    });
    const piiKms = configuredPiiSubjectKms();
    const records: MailAccountRecord[] = [];
    for (const raw of rows) {
      const row = piiKms
        ? await decryptPiiFieldValues(
            raw as Record<string, unknown>,
            MAIL_ACCOUNT_PII_FIELDS,
            piiKms,
            { requestId: "inbound-mail-foundation:supervisor:list-accounts" },
          )
        : (raw as Record<string, unknown>);
      records.push({
        id: row["id"] as string,
        tenantId: row["tenantId"] as string,
        provider: row["provider"] as string,
        authMethod: row["authMethod"] as string,
        ownerUserId: (row["ownerUserId"] as string | null | undefined) ?? null,
        address: row["address"] as string,
        displayName: (row["displayName"] as string | undefined) ?? "",
        status: InboundMailAccountStatuses.active,
        watchState: (row["watchState"] as string | undefined) ?? "idle",
      });
    }
    return records;
  }

  // ---------------------------------------------------------------
  // Cursor-Persistenz (unmanaged direct-write store).
  // ---------------------------------------------------------------
  async function loadCursor(accountId: string): Promise<SyncCursorPayload | null> {
    const row = await fetchOne<{ cursor: string }>(deps.db, syncCursorTable as EntityTableMeta, {
      accountId,
      scope: CURSOR_SCOPE,
    });
    if (!row) return null;
    try {
      return JSON.parse(row.cursor) as SyncCursorPayload; // @cast-boundary eigene JSON-Persistenz
    } catch {
      return null; // korrupter Cursor = wie kein Cursor → Backfill, Dedup fängt Dubletten
    }
  }

  async function saveCursor(accountId: string, cursor: SyncCursorPayload): Promise<void> {
    const now = Temporal.Now.instant().toString();
    const serialized = JSON.stringify(cursor);
    const existing = await fetchOne<{ id: string }>(deps.db, syncCursorTable as EntityTableMeta, {
      accountId,
      scope: CURSOR_SCOPE,
    });
    if (existing) {
      await updateMany(
        deps.db,
        syncCursorTable as EntityTableMeta,
        { cursor: serialized, updatedAt: now },
        { accountId, scope: CURSOR_SCOPE },
      );
      // skip: update-Pfad fertig — nicht in den insert-Zweig durchfallen.
      return;
    }
    await insertOne(deps.db, syncCursorTable as EntityTableMeta, {
      id: crypto.randomUUID(),
      accountId,
      scope: CURSOR_SCOPE,
      cursor: serialized,
      updatedAt: now,
    });
  }

  async function resetCursor(accountId: string): Promise<void> {
    // Kein deleteMany-Import nötig: leerer Cursor-String parsed zu null
    // → nächster fetch läuft als Backfill.
    await updateMany(
      deps.db,
      syncCursorTable as EntityTableMeta,
      { cursor: "", updatedAt: Temporal.Now.instant().toString() },
      { accountId, scope: CURSOR_SCOPE },
    );
  }

  // ---------------------------------------------------------------
  // Ingest — jede Message durch den Standard-Write-Handler.
  // ---------------------------------------------------------------
  async function ingestBatch(
    account: MailAccountRecord,
    msgs: readonly RawInboundMessage[],
    cursorSnapshot: string,
  ): Promise<void> {
    for (const msg of msgs) {
      const bodyRef = deps.storeBody && msg.rawMime ? await deps.storeBody(account, msg) : "";
      const result = await deps.dispatchWrite({
        handlerQn: InboundMailFoundationHandlers.ingestMessage,
        tenantId: account.tenantId,
        payload: {
          accountId: account.id,
          ownerUserId: account.ownerUserId,
          providerName: account.provider,
          providerMessageId: msg.providerMessageId,
          messageIdHeader: msg.messageIdHeader,
          providerThreadId: msg.providerThreadId,
          references: msg.references,
          from: msg.from,
          to: msg.to,
          cc: msg.cc,
          subject: msg.subject,
          snippet: msg.snippet,
          receivedAtIso: msg.receivedAtIso,
          bodyRef,
          scope: msg.scope,
          providerCursor: cursorSnapshot,
        },
      });
      if (!result.isSuccess) {
        // Einzel-Message-Fehler bricht den Batch: Cursor wird NICHT
        // persistiert → nächster Tick re-fetcht ab altem Cursor, Dedup
        // überspringt die bereits verarbeiteten.
        throw new Error(
          `ingest-message failed for account ${account.id}: ${JSON.stringify(result.error ?? {})}`,
        );
      }
    }
  }

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
  // Fehler-Semantik (Plan §2-Tabelle) — geteilt von Poll und Watch.
  // Liefert true wenn der Account weiterlaufen darf.
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
      return true; // nächster Tick versucht es erneut
    }
    if (isInboundCursorInvalidError(err)) {
      log(`inbound-mail: account ${account.id} cursor invalid — full resync in backfill window`);
      await resetCursor(account.id);
      return true;
    }
    // Transient/unbekannt: loggen, nächster Tick retried.
    log(
      `inbound-mail: account ${account.id} sync error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return true;
  }

  // ---------------------------------------------------------------
  // Poll (Reconciliation).
  // ---------------------------------------------------------------
  async function pollAccount(
    account: MailAccountRecord,
    plugin: InboundMailProviderPlugin,
  ): Promise<void> {
    let cursor = await loadCursor(account.id);
    let budget = maxMessagesPerPoll;
    try {
      // hasMore-Schleife: Pagination innerhalb eines Ticks bis Budget.
      for (;;) {
        const result = await plugin.fetch(deps.providerCtx, account, cursor, {
          backfillWindowDays,
          maxMessages: budget,
        });
        await ingestBatch(account, result.messages, JSON.stringify(result.nextCursor));
        await saveCursor(account.id, result.nextCursor);
        cursor = result.nextCursor;
        budget -= result.messages.length;
        if (!result.hasMore || budget <= 0) break;
      }
    } catch (err) {
      await handleSyncError(account, err);
    }
  }

  async function pollOnce(): Promise<void> {
    const accounts = await listActiveAccounts();
    for (const account of accounts) {
      let plugin: InboundMailProviderPlugin;
      try {
        plugin = resolveInboundProviderForAccount(deps.providerCtx, account);
      } catch (err) {
        log(`inbound-mail: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      await pollAccount(account, plugin);
      if (running) await ensureWatcher(account, plugin);
    }
    // Accounts die nicht mehr aktiv sind: Watcher abbauen.
    const activeIds = new Set(accounts.map((a) => a.id));
    for (const accountId of watchers.keys()) {
      if (!activeIds.has(accountId)) await stopWatcher(accountId);
    }
  }

  // ---------------------------------------------------------------
  // Watch-Lifecycle mit Backoff-Restart.
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
      void (async () => {
        state.renewTimer = null;
        // skip: supervisor stopped, generation superseded, or lease already lost — stale timer fire, nothing to renew.
        if (!running || state.generation !== generation || !state.lockToken || !deps.lock) return;
        let renewed: boolean;
        try {
          renewed = await deps.lock.renew(account.id, state.lockToken, leaseTtlSeconds);
        } catch (err) {
          log(
            `inbound-mail: watch lease renew for account ${account.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          state.renewFailures += 1;
          // After failures spanning a full lease TTL, tear down — otherwise a
          // peer can acquire the expired key while we still hold an IDLE conn.
          if (state.renewFailures * renewIntervalMs >= leaseTtlSeconds * 1000) {
            log(
              `inbound-mail: watch lease renew for account ${account.id} failed across TTL — tearing down local watcher`,
            );
            state.lockToken = null;
            await stopWatcher(account.id);
            // skip: local watcher torn down after renew failures spanning a full lease TTL.
            return;
          }
          if (running && state.generation === generation && state.lockToken) {
            scheduleRenew(account, state, generation);
          }
          // skip: renew already rescheduled above (or conditions no longer hold) — nothing left to do this tick.
          return;
        }
        state.renewFailures = 0;
        if (!renewed) {
          log(
            `inbound-mail: watch lease for account ${account.id} lost — tearing down local watcher`,
          );
          state.lockToken = null;
          await stopWatcher(account.id);
          // skip: watcher already torn down by stopWatcher() above — nothing left to do.
          return;
        }
        if (running && state.generation === generation && state.lockToken) {
          scheduleRenew(account, state, generation);
        }
      })();
    }, renewIntervalMs);
  }

  // kumiko-lint-ignore complexity-budget yield-point stale-map check after acquire is intentional (#2460)
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

  async function ensureWatcher(
    account: MailAccountRecord,
    plugin: InboundMailProviderPlugin,
  ): Promise<void> {
    // skip: Provider ohne Live-Push — der Reconciliation-Poll deckt den Account ab.
    if (!plugin.watch) return;
    const existing = watchers.get(account.id);
    // skip: Watcher läuft bereits, startet gerade, oder Restart ist geplant.
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
      // skip: Supervisor gestoppt oder Watcher-Generation gewechselt — Restart wäre ein Zombie.
      if (!running || state.generation !== generation) return;
      state.stop = null;
      const delay = state.backoffMs;
      state.backoffMs = Math.min(state.backoffMs * 2, backoffMaxMs);
      log(
        `inbound-mail: watch for account ${account.id} died (${err instanceof Error ? err.message : String(err)}) — restart in ${delay}ms`,
      );
      void markAccount(account, { watchState: `backoff:${delay}ms` }, "watch_supervisor");
      state.restartTimer = setTimeout(() => {
        state.restartTimer = null;
        void ensureWatcher(account, plugin);
      }, delay);
    };

    state.starting = true;
    try {
      const stop = await plugin.watch(deps.providerCtx, account, {
        onMessages: async (msgs) => {
          try {
            await ingestBatch(account, msgs, "watch");
          } catch (err) {
            // Ingest-Fehler killt den Watcher nicht — der Poll holt die
            // Messages beim nächsten Tick (Dedup macht's idempotent).
            log(
              `inbound-mail: watch-ingest for account ${account.id} failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
        onError: (err) => {
          void (async () => {
            const keepRunning = await handleSyncError(account, err);
            // auth_error → stopWatcher hat die generation gebumpt,
            // scheduleRestart no-op't; für alle anderen: Backoff-Restart.
            if (keepRunning) scheduleRestart(err);
          })();
        },
      });
      if (state.generation !== generation || !running) {
        await stop();
        // skip: stop() kam während des Connects — Watcher wurde sofort wieder abgebaut.
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
          `inbound-mail: markAccount(watching) for account ${account.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch (err) {
      const keepRunning = await handleSyncError(account, err);
      if (keepRunning) scheduleRestart(err);
    } finally {
      state.starting = false;
    }
  }

  async function stopWatcher(accountId: string): Promise<void> {
    const state = watchers.get(accountId);
    // skip: kein Watcher-State für diesen Account — bereits abgebaut.
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
        log(
          `inbound-mail: stop watcher ${accountId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (deps.lock && lockToken) {
      try {
        await deps.lock.release(accountId, lockToken);
      } catch (err) {
        log(
          `inbound-mail: watch lease release for account ${accountId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------
  // Lifecycle.
  // ---------------------------------------------------------------
  function scheduleNextPoll(): void {
    // skip: Supervisor gestoppt — keinen weiteren Poll-Tick planen.
    if (!running) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      pollInFlight = pollOnce()
        .catch((err) =>
          log(
            `inbound-mail: poll tick failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
        .finally(() => {
          pollInFlight = null;
          scheduleNextPoll();
        });
    }, pollIntervalMs);
  }

  return {
    async start() {
      // skip: bereits gestartet — start() ist idempotent.
      if (running) return;
      running = true;
      await pollOnce();
      scheduleNextPoll();
    },
    pollOnce,
    async stop() {
      running = false;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (pollInFlight) await pollInFlight;
      for (const accountId of [...watchers.keys()]) {
        await stopWatcher(accountId);
      }
    },
  };
}
