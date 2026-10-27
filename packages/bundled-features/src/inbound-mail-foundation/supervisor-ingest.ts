// Per-message ingest for the sync supervisor. Every message is isolated: a poison mail must not
// block the cursor of its mailbox, but a systemic outage (database, projection, KMS, file storage,
// the app's storeBody hook) must not quarantine good mail either.
//
//   - permanent rejection (validation/unprocessable) -> quarantine immediately, continue
//   - provider-side parse failures (`rejected`) -> quarantine "unparseable"
//   - any other failure -> the batch goes on, then the failure is settled:
//     - proven (another mail of the account went through in the same poll, for a storage failure
//       another storage write) -> counted once per poll interval (persisted); the third counted
//       failure quarantines the mail as "ingest_failed", below that the cursor stays before it
//     - a mail that was counted before and is the only failure of this poll keeps being counted:
//       the counter row exists only because the mail failed while others went through. A KMS
//       failure is the exception, it is never the mail's
//     - unproven -> nothing is counted, the account is disrupted (degraded with the class of the
//       failure) and the next interval retries from the same cursor
//
// Every quarantine also imports the headers, so the mail stays visible in the inbox.

import { ENCRYPTION_UNAVAILABLE_CODE } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { errorCodeOf, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { InboundMailFoundationHandlers } from "./constants.ts";
import { FileStorageWriteFailedError, isFileStorageWriteFailure } from "./file-storage-failure.ts";
import {
  clearIngestFailures,
  countIngestFailure,
  hasCountedIngestFailure,
  MAX_COUNTED_INGEST_FAILURES,
} from "./ingest-failures.ts";
import { ingestPayloadOf } from "./ingest-payload.ts";
import { normalizeRawInboundMessage } from "./normalize-inbound-message.ts";
import { quarantineMessage } from "./quarantine.ts";
import type { QuarantineReasonCode } from "./quarantine-entities.ts";
import {
  headerOnlyOf,
  headerOnlyOfRejected,
  importQuarantinedHeaders,
} from "./quarantine-header-import.ts";
import type { MailAccountRecord, RawInboundMessage, RejectedInboundMessage } from "./types.ts";

const PERMANENT_ERROR_CODES: ReadonlySet<string> = new Set(["validation_error", "unprocessable"]);

export type DispatchWrite = (args: {
  readonly handlerQn: string;
  readonly payload: unknown;
  readonly tenantId: string;
}) => Promise<{ readonly isSuccess: boolean; readonly data?: unknown; readonly error?: unknown }>;

export type IngestBlockedReason =
  | "file_storage_unavailable"
  | "encryption_unavailable"
  | "ingest_unavailable"
  | "message_failing";

/** What earlier batches of the same poll proved to work. */
export type IngestProof = {
  /** A mail was newly ingested (a duplicate proves nothing: it returns before any write). */
  readonly ingested: boolean;
  /** A content write to file storage or through the storeBody hook went through. */
  readonly storageHealthy: boolean;
};

export type IngestBatchOutcome = IngestProof & {
  readonly quarantinedNew: number;
  /** True when a message needed file storage and none was available. */
  readonly storageUnavailable: boolean;
  /** Set when the batch has an unresolved failure: the cursor must not move past it. */
  readonly blocked?: IngestBlockedReason;
};

export type IngestBatchOptions = {
  /** Poll-interval bucket of a regular tick; absent (wake, manual sync) means failures are not counted. */
  readonly countBucket?: number;
  readonly signal?: AbortSignal;
  readonly proof?: IngestProof;
};

export type MessageIngester = {
  readonly ingestBatch: (
    account: MailAccountRecord,
    msgs: readonly RawInboundMessage[],
    rejected: readonly RejectedInboundMessage[],
    cursorSnapshot: string,
    options?: IngestBatchOptions,
  ) => Promise<IngestBatchOutcome>;
};

type IngesterDeps = {
  readonly db: DbConnection;
  readonly dispatchWrite: DispatchWrite;
  readonly storeBody?: (account: MailAccountRecord, msg: RawInboundMessage) => Promise<string>;
  readonly log: (line: string) => void;
};

type FailureClass = "storage" | "encryption" | "ingest";

type Attempt =
  | {
      readonly kind: "ingested";
      readonly duplicate: boolean;
      readonly storage: unknown;
      readonly storedBody: boolean;
    }
  | { readonly kind: "permanent" }
  | { readonly kind: "failed"; readonly failure: FailureClass };

type Failure = { readonly msg: RawInboundMessage; readonly failure: FailureClass };

function attemptOfFailure(failure: unknown): Attempt {
  if (isFileStorageWriteFailure(failure)) return { kind: "failed", failure: "storage" };
  const code = errorCodeOf(failure);
  if (code === ENCRYPTION_UNAVAILABLE_CODE) return { kind: "failed", failure: "encryption" };
  return code !== undefined && PERMANENT_ERROR_CODES.has(code)
    ? { kind: "permanent" }
    : { kind: "failed", failure: "ingest" };
}

// The most specific class names the outage: a KMS or storage failure explains the generic ones.
function blockedReasonOf(failures: readonly FailureClass[]): IngestBlockedReason {
  if (failures.includes("encryption")) return "encryption_unavailable";
  if (failures.includes("storage")) return "file_storage_unavailable";
  return "ingest_unavailable";
}

export function createMessageIngester(deps: IngesterDeps): MessageIngester {
  async function quarantine(
    account: MailAccountRecord,
    providerMessageId: string,
    reason: QuarantineReasonCode,
    headerOnly: RawInboundMessage | null,
  ): Promise<boolean> {
    const created = await quarantineMessage(
      deps.db,
      { tenantId: account.tenantId, accountId: account.id, providerMessageId },
      reason,
    );
    await clearIngestFailures(deps.db, account.id, [providerMessageId]);
    await importQuarantinedHeaders(deps, account, headerOnly);
    // Ids only: subject and sender of a poison mail stay out of logs.
    deps.log(`inbound-mail: account ${account.id} quarantined a message (${reason})`);
    return created;
  }

  async function storeBodyOf(account: MailAccountRecord, raw: RawInboundMessage): Promise<string> {
    if (!deps.storeBody || !raw.rawMime) return "";
    try {
      return await deps.storeBody(account, raw);
    } catch (err) {
      // The app hook writes to the app's storage: its failure is a storage failure, not the mail's.
      throw new FileStorageWriteFailedError(err instanceof Error ? err : undefined);
    }
  }

  async function attempt(
    account: MailAccountRecord,
    raw: RawInboundMessage,
    cursorSnapshot: string,
  ): Promise<Attempt> {
    try {
      const msg = normalizeRawInboundMessage(raw);
      const bodyRef = await storeBodyOf(account, raw);
      const result = await deps.dispatchWrite({
        handlerQn: InboundMailFoundationHandlers.ingestMessage,
        tenantId: account.tenantId,
        payload: ingestPayloadOf(account, msg, { providerCursor: cursorSnapshot, bodyRef }),
      });
      if (result.isSuccess) {
        return {
          kind: "ingested",
          duplicate: propertyOf(result.data, "duplicate") === true,
          storage: propertyOf(result.data, "contentStorage"),
          storedBody: bodyRef !== "",
        };
      }
      return attemptOfFailure(result.error ?? {});
    } catch (err) {
      return attemptOfFailure(err);
    }
  }

  // Returns the failures left unresolved: "proven" ones wait for their count, the others are the
  // account's outage.
  async function settleFailures(
    account: MailAccountRecord,
    failures: readonly Failure[],
    proof: IngestProof,
    options: IngestBatchOptions,
  ): Promise<{ quarantinedNew: number; blocked?: IngestBlockedReason }> {
    let quarantinedNew = 0;
    const unproven: FailureClass[] = [];
    let waiting = false;
    // An abandoned sync (deadline) must not count; its failures are the deadline's.
    const bucket = options.signal?.aborted ? undefined : options.countBucket;
    for (const { msg, failure } of failures) {
      const target = {
        tenantId: account.tenantId,
        accountId: account.id,
        providerMessageId: msg.providerMessageId,
      };
      // A KMS failure is the key store's, so an earlier count of the mail never carries it.
      // Accepted residue, no mail is lost and each case is visible:
      //   - a first failure without proof never counts: degraded until the next new mail
      //   - a KMS failure of one mail only holds the cursor, shown as encryption_unavailable
      //   - a storage or ingest outage can finish the count of a mail counted before (retry exists)
      const proven =
        (failure === "storage" ? proof.storageHealthy : proof.ingested) ||
        (failure !== "encryption" &&
          failures.length === 1 &&
          (await hasCountedIngestFailure(deps.db, target)));
      if (!proven) {
        unproven.push(failure);
        continue;
      }
      const count = bucket === undefined ? null : await countIngestFailure(deps.db, target, bucket);
      if (count !== null && count >= MAX_COUNTED_INGEST_FAILURES) {
        const headerOnly = headerOnlyOf(msg);
        if (await quarantine(account, msg.providerMessageId, "ingest_failed", headerOnly)) {
          quarantinedNew += 1;
        }
        continue;
      }
      waiting = true;
    }
    if (unproven.length > 0) return { quarantinedNew, blocked: blockedReasonOf(unproven) };
    return { quarantinedNew, ...(waiting && { blocked: "message_failing" as const }) };
  }

  async function quarantineRejected(
    account: MailAccountRecord,
    rejected: readonly RejectedInboundMessage[],
  ): Promise<number> {
    let created = 0;
    for (const entry of rejected) {
      const headerOnly = headerOnlyOfRejected(entry);
      if (await quarantine(account, entry.providerMessageId, "unparseable", headerOnly))
        created += 1;
    }
    return created;
  }

  async function ingestBatch(
    account: MailAccountRecord,
    msgs: readonly RawInboundMessage[],
    rejected: readonly RejectedInboundMessage[],
    cursorSnapshot: string,
    options: IngestBatchOptions = {},
  ): Promise<IngestBatchOutcome> {
    let quarantinedNew = await quarantineRejected(account, rejected);
    let storageUnavailable = false;
    let ingested = options.proof?.ingested ?? false;
    let storageHealthy = options.proof?.storageHealthy ?? false;
    const failures: Failure[] = [];
    for (const msg of msgs) {
      const result = await attempt(account, msg, cursorSnapshot);
      if (result.kind === "permanent") {
        const headerOnly = headerOnlyOf(msg);
        const created = await quarantine(
          account,
          msg.providerMessageId,
          "invalid_message",
          headerOnly,
        );
        if (created) quarantinedNew += 1;
        continue;
      }
      if (result.kind === "failed") {
        failures.push({ msg, failure: result.failure });
        continue;
      }
      await clearIngestFailures(deps.db, account.id, [msg.providerMessageId]);
      if (result.storage === "unavailable") storageUnavailable = true;
      if (result.storage === "stored" || result.storedBody) storageHealthy = true;
      if (!result.duplicate) ingested = true;
    }
    const settled =
      failures.length > 0
        ? await settleFailures(account, failures, { ingested, storageHealthy }, options)
        : { quarantinedNew: 0 };
    return {
      quarantinedNew: quarantinedNew + settled.quarantinedNew,
      storageUnavailable,
      storageHealthy,
      ingested,
      ...(settled.blocked && { blocked: settled.blocked }),
    };
  }

  return { ingestBatch };
}
