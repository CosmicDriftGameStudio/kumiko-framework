// Immediate sync of one account, used when a mailbox was just connected, reconnected or re-activated.
// Shares the per-account in-flight guard with the regular poll, so a wake never runs a second fetch
// next to a running tick for the same account; a caller that loses the race joins the running one.

import type { SyncableAccount } from "./syncable-accounts.ts";
import type { InboundMailProviderPlugin } from "./types.ts";

export type PollAccountOptions = {
  readonly fromWake?: boolean;
  /** Aborted when the supervisor abandons this sync; an aborted sync stores nothing. */
  readonly signal?: AbortSignal;
  /** Set by regular ticks only: ingest failures count once per bucket. Wake and manual syncs never count. */
  readonly countBucket?: number;
};
/** "credential_pending": the secret is not stored yet, nothing was polled and no status was set. */
export type PollAccountResult = "done" | "credential_pending";

export type InFlightSyncs = Map<string, Promise<void>>;

/** Runs `run` unless a sync for the account is already in flight; then returns that one instead. */
export function runExclusivePerAccount(
  inFlight: InFlightSyncs,
  accountId: string,
  run: () => Promise<void>,
): Promise<void> {
  const running = inFlight.get(accountId);
  if (running) return running;
  const started = run().finally(() => {
    inFlight.delete(accountId);
  });
  inFlight.set(accountId, started);
  return started;
}

export function createSyncAccountNow(deps: {
  readonly inFlight: InFlightSyncs;
  readonly loadAccount: (accountId: string) => Promise<SyncableAccount | undefined>;
  readonly resolvePlugin: (account: SyncableAccount) => InboundMailProviderPlugin | undefined;
  readonly pollAccount: (
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
    options: PollAccountOptions,
  ) => Promise<PollAccountResult>;
  readonly ensureWatcher: (
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
  ) => Promise<void>;
  readonly isRunning: () => boolean;
}): (accountId: string) => Promise<void> {
  return (accountId) =>
    runExclusivePerAccount(deps.inFlight, accountId, async () => {
      const account = await deps.loadAccount(accountId);
      // skip: the account is gone or no longer syncable.
      if (!account) return;
      const plugin = deps.resolvePlugin(account);
      // skip: no provider plugin for this account; resolvePlugin logged it.
      if (!plugin) return;
      const result = await deps.pollAccount(account, plugin, { fromWake: true });
      if (result === "done" && deps.isRunning()) await deps.ensureWatcher(account, plugin);
    });
}
