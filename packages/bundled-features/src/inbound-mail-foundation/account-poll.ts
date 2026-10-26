import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { AccountHealth, PollFailureKind } from "./account-health.ts";
import { refetchSnippetOnlyMessages } from "./content-refetch.ts";
import { describeError } from "./describe-error.ts";
import { seenMessageTable } from "./entities.ts";
import {
  isInboundAuthError,
  isInboundCredentialNotStoredError,
  isInboundCursorInvalidError,
  isInboundRateLimitError,
} from "./provider-errors.ts";
import { quarantinedMessageIds } from "./quarantine.ts";
import { retryQuarantinedMessages } from "./quarantine-retry.ts";
import type {
  DispatchWrite,
  IngestBatchOutcome,
  IngestBlockedReason,
  MessageIngester,
} from "./supervisor-ingest.ts";
import type { PollAccountOptions, PollAccountResult } from "./sync-account-now.ts";
import type { SyncCursorStore } from "./sync-cursor-store.ts";
import type { SyncableAccount } from "./syncable-accounts.ts";
import type { InboundMailContext, InboundMailProviderPlugin, MailAccountRecord } from "./types.ts";

const SEEN_LOOKUP_CHUNK_SIZE = 1000;

export type AccountPollerDeps = {
  readonly systemDb: DbConnection;
  readonly cursors: SyncCursorStore;
  readonly ingester: MessageIngester;
  readonly health: AccountHealth;
  readonly providerCtx: InboundMailContext;
  readonly dispatchWrite: DispatchWrite;
  readonly backfillWindowDays: number;
  readonly maxMessagesPerPoll: number;
  readonly resolveAccessToken: (
    account: MailAccountRecord,
    plugin: InboundMailProviderPlugin,
  ) => Promise<string | undefined>;
  /** Returns true when the account may keep running. */
  readonly handleSyncError: (account: MailAccountRecord, err: unknown) => Promise<boolean>;
  readonly log: (line: string) => void;
};

export function createAccountPoller(deps: AccountPollerDeps): {
  readonly pollAccount: (
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
    options?: PollAccountOptions,
  ) => Promise<PollAccountResult>;
} {
  const {
    systemDb,
    cursors,
    ingester,
    health,
    providerCtx,
    backfillWindowDays,
    maxMessagesPerPoll,
    resolveAccessToken,
    handleSyncError,
    log,
  } = deps;

  function unknownMessageIdsFilterFor(account: MailAccountRecord) {
    return async (providerMessageIds: readonly string[]): Promise<ReadonlySet<string>> => {
      if (providerMessageIds.length === 0) return new Set();
      // One bind parameter per id: a full-mailbox listing would exceed Postgres' 65535 limit.
      const seenIds = new Set<string>();
      for (let start = 0; start < providerMessageIds.length; start += SEEN_LOOKUP_CHUNK_SIZE) {
        const seen = await selectMany<{ providerMessageId: string }>(
          systemDb,
          seenMessageTable,
          {
            tenantId: account.tenantId,
            accountId: account.id,
            providerMessageId: {
              in: providerMessageIds.slice(start, start + SEEN_LOOKUP_CHUNK_SIZE),
            },
          },
          { fields: ["providerMessageId"] },
        );
        for (const row of seen) seenIds.add(row.providerMessageId);
      }
      // A quarantined message counts as seen: re-fetching it would only fail the same way again.
      for (const id of await quarantinedMessageIds(systemDb, account.id, providerMessageIds)) {
        seenIds.add(id);
      }
      return new Set(providerMessageIds.filter((id) => !seenIds.has(id)));
    };
  }

  function pollFailureKindOf(err: unknown): PollFailureKind | null {
    if (isInboundAuthError(err) || isInboundCursorInvalidError(err)) return null;
    return isInboundRateLimitError(err) ? "rate_limited" : "transient";
  }

  async function refetchContentSafely(
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    // skip: the provider cannot reload content.
    if (!plugin.fetchContent) return;
    try {
      const accessToken = await resolveAccessToken(account, plugin);
      await refetchSnippetOnlyMessages({
        db: systemDb,
        dispatchWrite: deps.dispatchWrite,
        providerCtx,
        account,
        plugin,
        windowDays: backfillWindowDays,
        accessToken,
        signal,
      });
    } catch (err) {
      // Best effort: the sync itself succeeded, the next tick retries the reload.
      log(`inbound-mail: content reload for account ${account.id} failed: ${describeError(err)}`);
    }
  }

  async function retryQuarantineSafely(
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    try {
      const accessToken = await resolveAccessToken(account, plugin);
      await retryQuarantinedMessages({
        db: systemDb,
        dispatchWrite: deps.dispatchWrite,
        providerCtx,
        account,
        plugin,
        accessToken,
        signal,
        log,
      });
    } catch (err) {
      // Best effort: the sync itself succeeded, the flag stays and the next tick retries.
      log(`inbound-mail: quarantine retry for account ${account.id} failed: ${describeError(err)}`);
    }
  }

  // Fetches and ingests batch after batch until the provider has no more or the message budget of
  // this tick is used up. An abandoned sync (deadline) throws out of the loop.
  async function ingestBatches(
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
    options: PollAccountOptions,
  ): Promise<{
    storageUnavailable: boolean;
    storageHealthy: boolean;
    blocked?: IngestBlockedReason;
  }> {
    const { signal } = options;
    let cursor = await cursors.load(account.id);
    let budget = maxMessagesPerPoll;
    const totals = { storageUnavailable: false, storageHealthy: false };
    for (;;) {
      const accessToken = await resolveAccessToken(account, plugin);
      const result = await plugin.fetch(providerCtx, account, cursor, {
        backfillWindowDays,
        maxMessages: budget,
        filterUnknownMessageIds: unknownMessageIdsFilterFor(account),
        ...(accessToken !== undefined && { accessToken }),
        ...(signal && { signal }),
      });
      // The sync was abandoned while the provider was busy; its late result is dropped.
      signal?.throwIfAborted();
      const outcome: IngestBatchOutcome = await ingester.ingestBatch(
        account,
        result.messages,
        result.rejected ?? [],
        JSON.stringify(result.nextCursor),
        {
          ...(options.countBucket !== undefined && { countBucket: options.countBucket }),
          ...(signal && { signal }),
        },
      );
      totals.storageUnavailable ||= outcome.storageUnavailable;
      totals.storageHealthy ||= outcome.storageHealthy;
      // Blocked: the cursor stays before the stuck mail, the next tick fetches it again.
      if (outcome.blocked) return { ...totals, blocked: outcome.blocked };
      // A newer poll may already own the account; an abandoned one must not move its cursor back.
      signal?.throwIfAborted();
      await cursors.save(account, result.nextCursor);
      cursor = result.nextCursor;
      budget -= result.messages.length;
      if (!result.hasMore || budget <= 0) return totals;
    }
  }

  async function pollAccount(
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
    options: PollAccountOptions = {},
  ): Promise<PollAccountResult> {
    let totals: Awaited<ReturnType<typeof ingestBatches>>;
    try {
      totals = await ingestBatches(account, plugin, options);
    } catch (err) {
      // skip: an error caused by abandoning the sync is already counted as the deadline failure.
      if (options.signal?.aborted) return "done";
      if (options.fromWake && isInboundCredentialNotStoredError(err)) {
        // The secret is written after the account is created; the next tick picks it up.
        log(`inbound-mail: account ${account.id} credential not stored yet, wake sync skipped`);
        return "credential_pending";
      }
      const stillRunning = await handleSyncError(account, err);
      const failureKind = pollFailureKindOf(err);
      if (stillRunning && failureKind) await health.onPollFailure(account, failureKind);
      return "done";
    }
    // skip: abandoned during the last batch; the deadline already counted this poll as failed.
    if (options.signal?.aborted) return "done";
    if (totals.blocked) {
      await health.onIngestBlocked(account, totals.blocked);
      return "done";
    }
    await health.onPollSuccess(account, totals);
    await retryQuarantineSafely(account, plugin, options.signal);
    await refetchContentSafely(account, plugin, options.signal);
    return "done";
  }

  return { pollAccount };
}
