import { describeError } from "./describe-error.ts";
import {
  type InFlightSyncs,
  type PollAccountOptions,
  type PollAccountResult,
  runExclusivePerAccount,
} from "./sync-account-now.ts";
import type { SyncableAccount } from "./syncable-accounts.ts";
import type { InboundMailProviderPlugin } from "./types.ts";

export type WatchCatchUp = {
  /** Fire-and-forget; failures are logged and never stop the watch. */
  readonly schedule: (account: SyncableAccount, plugin: InboundMailProviderPlugin) => void;
  readonly settled: () => Promise<unknown>;
};

/**
 * A watch only sees mail that arrives after its mailbox is open, so mail delivered between a
 * poll's fetch and the watch start would wait for the next tick. One poll that starts after the
 * watch is open closes that gap for every provider.
 */
export function createWatchCatchUp(deps: {
  readonly inFlight: InFlightSyncs;
  readonly pollAccount: (
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
    options: PollAccountOptions,
  ) => Promise<PollAccountResult>;
  readonly isRunning: () => boolean;
  readonly log: (line: string) => void;
}): WatchCatchUp {
  const pending = new Set<Promise<void>>();

  async function catchUp(
    account: SyncableAccount,
    plugin: InboundMailProviderPlugin,
  ): Promise<void> {
    // A sync running now may have fetched before the mailbox was open, so joining it would not close the gap.
    for (
      let running = deps.inFlight.get(account.id);
      running;
      running = deps.inFlight.get(account.id)
    ) {
      await running.catch(() => {});
    }
    // skip: the supervisor stopped while the sync ran.
    if (!deps.isRunning()) return;
    await runExclusivePerAccount(deps.inFlight, account.id, async () => {
      await deps.pollAccount(account, plugin, {});
    });
  }

  return {
    schedule(account, plugin) {
      const task: Promise<void> = catchUp(account, plugin)
        .catch((err) =>
          deps.log(
            `inbound-mail: watch catch-up for account ${account.id} failed: ${describeError(err)}`,
          ),
        )
        .finally(() => {
          pending.delete(task);
        });
      pending.add(task);
    },
    settled: () => Promise.allSettled([...pending]),
  };
}
