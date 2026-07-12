// createInboundMailSupervisor — der langlebige Sync-Prozess der
// Foundation: startet pro aktivem Account `plugin.watch()` (IMAP IDLE,
// Push in Sekunden) mit Reconnect-Backoff und fährt zusätzlich den
// periodischen Reconciliation-Poll (Default 5 min) über `plugin.fetch()`.
// Dedup im ingest-Handler macht Watch/Poll-Überschneidung idempotent —
// der Poll ist Korrektheits-Anker, watch nur Latenz-Optimierung.
//
// **Plan-Abweichung (dokumentiert):** Der Plan sah den Poll als
// `r.job`-Cron vor. JobContext hat aber KEINEN Dispatcher (verifiziert:
// run-export-jobs.ts "Worker-AppContext hat kein queryAs/write") — der
// ingest MUSS durch den Standard-Write-Handler (ES-Executor, PII,
// Idempotency). Deshalb ist der Supervisor eine app-verdrahtete
// Komponente mit `dispatchSystemWrite` in den Deps, exakt wie
// billing-foundation's webhook-handler. Der App-Owner startet ihn in
// bin/server.ts:
//
//   const supervisor = createInboundMailSupervisor({
//     providerCtx: { registry: deps.registry, secrets },
//     db,
//     dispatchWrite: ({ handlerQn, payload, tenantId }) =>
//       deps.dispatchSystemWrite({ handlerQn, payload, tenantId: tenantId as TenantId }),
//   });
//   await supervisor.start();
//   // shutdown-hook: await supervisor.stop();
//
// **Betriebsrisiko IDLE (Plan §7.3):** langlebige Sockets im Prozess.
// Mitigation hier: Backoff-Restart via onError, sauberes stop() aller
// Watcher beim Shutdown, Poll fängt jede Lücke.

import { fetchOne, insertOne, selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection, EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
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
/** V1: ein Cursor pro Account (eine Mailbox-Inbox). Multi-Folder später
 *  über weitere scopes ohne Schema-Änderung. */
const CURSOR_SCOPE = "default";

export type InboundMailSupervisorDeps = {
  /** Slim-Context für Provider-Calls (registry Pflicht, secrets für
   *  Credential-Reads der Provider). */
  readonly providerCtx: InboundMailContext;
  /** App-DB — direct reads auf read_mail_accounts (Account-Snapshot)
   *  + direct writes auf read_mail_sync_cursors (unmanaged store). */
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
  readonly log?: (line: string) => void;
};

type WatcherState = {
  stop: (() => Promise<void>) | null;
  backoffMs: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  /** Bump beim stop() — verhindert dass ein nachzügelnder Restart einen
   *  bereits gestoppten Watcher wiederbelebt. */
  generation: number;
};

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
        "watch-supervisor",
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
  async function ensureWatcher(
    account: MailAccountRecord,
    plugin: InboundMailProviderPlugin,
  ): Promise<void> {
    if (!plugin.watch) return;
    const existing = watchers.get(account.id);
    if (existing?.stop || existing?.restartTimer) return; // läuft bzw. Restart geplant

    const state: WatcherState = existing ?? {
      stop: null,
      backoffMs: backoffInitialMs,
      restartTimer: null,
      generation: 0,
    };
    watchers.set(account.id, state);
    const generation = state.generation;

    const scheduleRestart = (err: unknown) => {
      if (!running || state.generation !== generation) return;
      state.stop = null;
      const delay = state.backoffMs;
      state.backoffMs = Math.min(state.backoffMs * 2, backoffMaxMs);
      log(
        `inbound-mail: watch for account ${account.id} died (${err instanceof Error ? err.message : String(err)}) — restart in ${delay}ms`,
      );
      void markAccount(account, { watchState: `backoff:${delay}ms` }, "watch-supervisor");
      state.restartTimer = setTimeout(() => {
        state.restartTimer = null;
        void ensureWatcher(account, plugin);
      }, delay);
    };

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
        // stop() kam während des Connects — sofort wieder abbauen.
        await stop();
        return;
      }
      state.stop = stop;
      state.backoffMs = backoffInitialMs;
      void markAccount(account, { watchState: "watching" }, "watch-supervisor");
    } catch (err) {
      const keepRunning = await handleSyncError(account, err);
      if (keepRunning) scheduleRestart(err);
    }
  }

  async function stopWatcher(accountId: string): Promise<void> {
    const state = watchers.get(accountId);
    if (!state) return;
    state.generation += 1;
    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
      state.restartTimer = null;
    }
    const stop = state.stop;
    state.stop = null;
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
  }

  // ---------------------------------------------------------------
  // Lifecycle.
  // ---------------------------------------------------------------
  function scheduleNextPoll(): void {
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
