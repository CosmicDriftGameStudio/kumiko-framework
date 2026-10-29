import type { DistributedLock } from "@cosmicdrift/kumiko-framework/pipeline";
import { describeError } from "./describe-error.ts";
import type { MailAccountRecord } from "./types.ts";
import type { WatcherState, WatchLeaseResult } from "./watch-supervisor-types.ts";

export type WatchLease = {
  readonly acquire: (account: MailAccountRecord, state: WatcherState) => Promise<WatchLeaseResult>;
};

// The cross-worker claim on one account's watch: acquired before plugin.watch(), renewed by a
// heartbeat for as long as the watcher state exists, and given up locally once it is lost.
export function createWatchLease(deps: {
  readonly lock: DistributedLock;
  readonly ttlSeconds: number;
  readonly renewIntervalMs: number;
  readonly watchers: ReadonlyMap<string, WatcherState>;
  readonly isRunning: () => boolean;
  readonly stopWatcher: (accountId: string) => Promise<void>;
  readonly log: (line: string) => void;
}): WatchLease {
  const { lock, ttlSeconds, renewIntervalMs, watchers, isRunning, stopWatcher, log } = deps;

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
    if (!isRunning() || state.generation !== generation || !state.lockToken) return;
    let renewed: boolean;
    try {
      renewed = await lock.renew(account.id, state.lockToken, ttlSeconds);
    } catch (err) {
      log(
        `inbound-mail: watch lease renew for account ${account.id} failed: ${describeError(err)}`,
      );
      state.renewFailures += 1;
      // After failures spanning a full lease TTL, tear down — otherwise a
      // peer can acquire the expired key while we still hold an IDLE conn.
      if (state.renewFailures * renewIntervalMs >= ttlSeconds * 1000) {
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
    if (isRunning() && state.generation === generation && state.lockToken) {
      scheduleRenew(account, state, generation);
    }
  }

  // kumiko-lint-ignore complexity-budget yield-point stale-map check after acquire is intentional
  async function acquire(
    account: MailAccountRecord,
    state: WatcherState,
  ): Promise<WatchLeaseResult> {
    if (state.lockToken) return "acquired";
    // A throwing lock (Redis outage) reads as "not claimed": the next tick retries instead of leaving the start flag set.
    const token = await lock.acquire(account.id, { ttlSeconds: ttlSeconds }).catch((err) => {
      log(
        `inbound-mail: watch lease acquire for account ${account.id} failed: ${describeError(err)}`,
      );
      return null;
    });
    if (!token) return "no-token";
    // The acquire() await is a yield point: a concurrent stopWatcher()
    // (e.g. from a lost-lease renewal on a different generation) may have
    // already retired this exact state and removed it from the map. If so,
    // committing the fresh token onto it would leak the lease — nothing
    // would ever release it, blocking failover for the full TTL.
    if (watchers.get(account.id) !== state) {
      await lock.release(account.id, token);
      return "stale";
    }
    state.lockToken = token;
    scheduleRenew(account, state, state.generation);
    return "acquired";
  }

  return { acquire };
}
