import type { DistributedLock } from "@cosmicdrift/kumiko-framework/pipeline";
import { describeError } from "./describe-error.ts";

// Suffix, not prefix: the app shares this lock (and its key prefix) with the watch lease, and ops
// scripts find a mailbox's watch lease by `:<accountId>` at the end of the key.
function pollLeaseKey(accountId: string): string {
  return `${accountId}:poll`;
}

export function createPollLease(deps: {
  readonly lock: DistributedLock;
  readonly pollIntervalMs: number;
  readonly log: (line: string) => void;
}) {
  // One second short of the interval, so the holder's next tick finds the lease expired.
  const ttlSeconds = Math.max(1, Math.floor(deps.pollIntervalMs / 1000) - 1);
  const held = new Map<string, string>();
  return {
    async claim(accountId: string): Promise<boolean> {
      try {
        const token = await deps.lock.acquire(pollLeaseKey(accountId), { ttlSeconds });
        if (token === null) return false;
        held.set(accountId, token);
        return true;
      } catch (err) {
        // Fail open: ingest deduplicates, a skipped poll would only delay mail.
        deps.log(
          `inbound-mail: poll lease for account ${accountId} unavailable, polling anyway: ${describeError(err)}`,
        );
        return true;
      }
    },
    async releaseAll(): Promise<void> {
      for (const [accountId, token] of held) {
        try {
          await deps.lock.release(pollLeaseKey(accountId), token);
        } catch (err) {
          deps.log(
            `inbound-mail: poll lease release for account ${accountId} failed: ${describeError(err)}`,
          );
        }
      }
      held.clear();
    },
  };
}
