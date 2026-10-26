// How the supervisor tick spreads its accounts: a bounded number of syncs side by side, and a
// deadline after which a sync that never answers is abandoned instead of holding the tick.

import type { PollAccountOptions, PollAccountResult } from "./sync-account-now.ts";
import type { SyncableAccount } from "./syncable-accounts.ts";
import type { InboundMailProviderPlugin } from "./types.ts";

export const DEFAULT_POLL_CONCURRENCY = 4;
export const DEFAULT_ACCOUNT_POLL_DEADLINE_MS = 10 * 60 * 1000;

export function pollScheduleOf(options: {
  readonly pollConcurrency?: number;
  readonly accountPollDeadlineMs?: number;
}): { readonly pollConcurrency: number; readonly accountPollDeadlineMs: number } {
  return {
    pollConcurrency: options.pollConcurrency ?? DEFAULT_POLL_CONCURRENCY,
    accountPollDeadlineMs: options.accountPollDeadlineMs ?? DEFAULT_ACCOUNT_POLL_DEADLINE_MS,
  };
}

/** Runs `work` for every item with at most `limit` running at once; a failing item is reported and does not stop the rest. */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
  onError: (item: T, err: unknown) => void,
): Promise<void> {
  // One shared iterator: advancing it is synchronous, so no two lanes take the same item.
  const queue = items[Symbol.iterator]();
  const lane = async (): Promise<void> => {
    for (let step = queue.next(); !step.done; step = queue.next()) {
      const item = step.value;
      await work(item).catch((err: unknown) => onError(item, err));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}

type DeadlineOutcome<T> =
  | { readonly timedOut: false; readonly value: T }
  | { readonly timedOut: true };

/** Aborts the signal when the deadline passes. The abandoned work may still settle later; its
 *  outcome is dropped and a late rejection is swallowed. */
async function runWithDeadline<T>(
  deadlineMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<DeadlineOutcome<T>> {
  const controller = new AbortController();
  const work = run(controller.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<DeadlineOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), deadlineMs);
  });
  try {
    const outcome = await Promise.race([
      work.then((value): DeadlineOutcome<T> => ({ timedOut: false, value })),
      deadline,
    ]);
    if (outcome.timedOut) {
      controller.abort();
      work.catch(() => {});
    }
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}

type PollAccount = (
  account: SyncableAccount,
  plugin: InboundMailProviderPlugin,
  options: PollAccountOptions,
) => Promise<PollAccountResult>;

/** A sync past the deadline counts as one failed poll and its in-flight slot is freed. */
export function withPollDeadline(
  pollAccount: PollAccount,
  deadline: {
    readonly ms: number;
    readonly onDeadline: (account: SyncableAccount) => Promise<void>;
  },
): PollAccount {
  return async (account, plugin, options) => {
    const outcome = await runWithDeadline(deadline.ms, (signal) =>
      pollAccount(account, plugin, { ...options, signal }),
    );
    if (!outcome.timedOut) return outcome.value;
    await deadline.onDeadline(account);
    return "done";
  };
}
