// Account health: maps what the supervisor observes (repeated poll failures, quarantined mails, file
// storage, KMS or ingest outage) onto the account status "degraded" plus a lastError code, and back to "active" once
// nothing is wrong any more. Auth errors and disconnects are never touched here. An update is
// dispatched only when status or lastError really changes, so a healthy mailbox causes no events.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  type InboundMailAccountStatus,
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  type InboundMailLastError,
  InboundMailLastErrors,
} from "./constants.ts";
import { hasOpenQuarantine } from "./quarantine.ts";
import type {
  DispatchWrite,
  IngestBatchOutcome,
  IngestBlockedReason,
} from "./supervisor-ingest.ts";
import type { AccountHealthRef, SyncableAccount } from "./syncable-accounts.ts";

const FAILURES_BEFORE_DEGRADED = 3;
const OUTAGE_LAST_ERRORS: ReadonlySet<string> = new Set([
  InboundMailLastErrors.encryptionUnavailable,
  InboundMailLastErrors.ingestUnavailable,
  InboundMailLastErrors.fileStorageUnavailable,
]);
const SUPERVISOR_AUDIT_REASON = "watch_supervisor";

export type PollFailureKind = "transient" | "rate_limited";

type AppliedHealth = {
  readonly status: InboundMailAccountStatus;
  readonly lastError: string | null;
};

export type AccountHealth = {
  readonly onPollSuccess: (
    account: SyncableAccount,
    outcome: Pick<IngestBatchOutcome, "storageUnavailable" | "storageHealthy">,
  ) => Promise<void>;
  readonly onPollFailure: (account: SyncableAccount, kind: PollFailureKind) => Promise<void>;
  /** The cursor stayed before a failing mail: either the mail waits for its count or the ingest is down. */
  readonly onIngestBlocked: (
    account: SyncableAccount,
    blocked: IngestBlockedReason,
    outcome: Pick<IngestBatchOutcome, "storageHealthy">,
  ) => Promise<void>;
  /** The address did not decrypt because the key store is down, so the account could not be polled. */
  readonly onKeyStoreUnavailable: (account: AccountHealthRef) => Promise<void>;
};

export function createAccountHealth(deps: {
  readonly db: DbConnection;
  readonly dispatchWrite: DispatchWrite;
  readonly log: (line: string) => void;
}): AccountHealth {
  const consecutiveFailures = new Map<string, number>();
  const storageUnavailable = new Set<string>();
  // The account snapshot of a tick is stale after our own update; this keeps the "real change" check honest.
  // Per process: a drift between workers costs at most one redundant update-account.
  const applied = new Map<string, AppliedHealth>();

  async function apply(account: AccountHealthRef, lastError: InboundMailLastError | null) {
    const known = applied.get(account.id) ?? {
      status: account.status,
      lastError: account.lastError,
    };
    const status =
      lastError === null ? InboundMailAccountStatuses.active : InboundMailAccountStatuses.degraded;
    // skip: the stored health already matches, nothing to write.
    if (known.status === status && known.lastError === lastError) return;
    const result = await deps.dispatchWrite({
      handlerQn: InboundMailFoundationHandlers.updateAccount,
      tenantId: account.tenantId,
      payload: { accountId: account.id, status, lastError, reason: SUPERVISOR_AUDIT_REASON },
    });
    if (!result.isSuccess) {
      deps.log(`inbound-mail: account ${account.id} health update was rejected`);
      // skip: not recorded as applied, so the next tick retries the update.
      return;
    }
    applied.set(account.id, { status, lastError });
  }

  async function lastErrorWithoutOutage(account: AccountHealthRef) {
    if (await hasOpenQuarantine(deps.db, account.id)) {
      return InboundMailLastErrors.messageQuarantined;
    }
    if (storageUnavailable.has(account.id)) return InboundMailLastErrors.fileStorageUnavailable;
    return null;
  }

  return {
    async onPollSuccess(account, outcome) {
      consecutiveFailures.delete(account.id);
      if (outcome.storageUnavailable) storageUnavailable.add(account.id);
      else if (outcome.storageHealthy) storageUnavailable.delete(account.id);
      return apply(account, await lastErrorWithoutOutage(account));
    },
    async onIngestBlocked(account, blocked, outcome) {
      consecutiveFailures.delete(account.id);
      if (blocked === "message_failing") {
        deps.log(`inbound-mail: account ${account.id} waits for a failing message to be counted`);
        if (outcome.storageHealthy) storageUnavailable.delete(account.id);
        // A counted failure proves the ingest works again, so a shown outage is over; anything else stays.
        const shown = (applied.get(account.id) ?? account).lastError;
        // skip: no outage is shown, the status stays as it is
        if (shown === null || !OUTAGE_LAST_ERRORS.has(shown)) return;
        return apply(account, await lastErrorWithoutOutage(account));
      }
      // KMS and ingest outages need no memory like storage: the next unblocked poll proves they are over.
      if (blocked === "encryption_unavailable") {
        return apply(account, InboundMailLastErrors.encryptionUnavailable);
      }
      if (blocked === "ingest_unavailable") {
        return apply(account, InboundMailLastErrors.ingestUnavailable);
      }
      storageUnavailable.add(account.id);
      return apply(account, InboundMailLastErrors.fileStorageUnavailable);
    },
    async onKeyStoreUnavailable(account) {
      consecutiveFailures.delete(account.id);
      return apply(account, InboundMailLastErrors.encryptionUnavailable);
    },
    async onPollFailure(account, kind) {
      const count = (consecutiveFailures.get(account.id) ?? 0) + 1;
      consecutiveFailures.set(account.id, count);
      // skip: below the failure threshold the mailbox stays as it is.
      if (count < FAILURES_BEFORE_DEGRADED) return;
      return apply(
        account,
        kind === "rate_limited"
          ? InboundMailLastErrors.rateLimited
          : InboundMailLastErrors.connectionFailed,
      );
    },
  };
}
