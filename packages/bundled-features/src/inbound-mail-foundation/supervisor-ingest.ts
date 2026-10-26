// Per-message ingest for the sync supervisor. Every message is isolated: a poison mail must not
// block the cursor of its mailbox, but a systemic outage (database, KMS, file storage) must not
// quarantine good mail either.
//
//   - permanent rejection (validation/unprocessable) -> quarantine immediately, continue
//   - file storage write failure -> stop the batch, never counted: the outage says nothing about the mail
//   - anything else -> counted once per poll interval (persisted); the third counted failure
//     quarantines the mail as "ingest_failed", below that the batch stops before the cursor moves
//   - provider-side parse failures (`rejected`) -> quarantine "unparseable"
//
// Every quarantine also imports the headers, so the mail stays visible in the inbox.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { errorCodeOf, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { InboundMailFoundationHandlers } from "./constants.ts";
import { isFileStorageWriteFailure } from "./file-storage-failure.ts";
import {
  clearIngestFailures,
  countIngestFailure,
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

export type IngestBlockedReason = "file_storage_unavailable" | "message_failing";

export type IngestBatchOutcome = {
  readonly quarantinedNew: number;
  /** True when a message needed file storage and none was available. */
  readonly storageUnavailable: boolean;
  /** True when at least one message with stored content went through. */
  readonly storageHealthy: boolean;
  /** Set when the batch stopped early: the cursor must not move past it. */
  readonly blocked?: IngestBlockedReason;
};

export type IngestBatchOptions = {
  /** Poll-interval bucket of a regular tick; absent (wake, manual sync) means failures are not counted. */
  readonly countBucket?: number;
  readonly signal?: AbortSignal;
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

type Attempt =
  | { readonly kind: "ingested"; readonly storage: unknown }
  | { readonly kind: "permanent" }
  | { readonly kind: "storage_failed" }
  | { readonly kind: "failed" };

function attemptOfFailure(failure: unknown): Attempt {
  if (isFileStorageWriteFailure(failure)) return { kind: "storage_failed" };
  const code = errorCodeOf(failure);
  return code !== undefined && PERMANENT_ERROR_CODES.has(code)
    ? { kind: "permanent" }
    : { kind: "failed" };
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

  async function attempt(
    account: MailAccountRecord,
    raw: RawInboundMessage,
    cursorSnapshot: string,
  ): Promise<Attempt> {
    try {
      const msg = normalizeRawInboundMessage(raw);
      const bodyRef = deps.storeBody && raw.rawMime ? await deps.storeBody(account, raw) : "";
      const result = await deps.dispatchWrite({
        handlerQn: InboundMailFoundationHandlers.ingestMessage,
        tenantId: account.tenantId,
        payload: ingestPayloadOf(account, msg, { providerCursor: cursorSnapshot, bodyRef }),
      });
      if (result.isSuccess) {
        return { kind: "ingested", storage: propertyOf(result.data, "contentStorage") };
      }
      return attemptOfFailure(result.error ?? {});
    } catch (err) {
      return attemptOfFailure(err);
    }
  }

  // "new"/"known": the mail was quarantined (newly or before) and the batch goes on; a blocked
  // reason stops the batch before the cursor moves.
  async function settleFailure(
    account: MailAccountRecord,
    msg: RawInboundMessage,
    kind: "permanent" | "storage_failed" | "failed",
    options: IngestBatchOptions,
  ): Promise<"new" | "known" | IngestBlockedReason> {
    const quarantined = async (reason: QuarantineReasonCode) =>
      (await quarantine(account, msg.providerMessageId, reason, headerOnlyOf(msg)))
        ? "new"
        : "known";
    if (kind === "permanent") return quarantined("invalid_message");
    if (kind === "storage_failed") return "file_storage_unavailable";
    // An abandoned sync (deadline) must not count; its failures are the deadline's.
    if (options.signal?.aborted || options.countBucket === undefined) return "message_failing";
    const count = await countIngestFailure(
      deps.db,
      {
        tenantId: account.tenantId,
        accountId: account.id,
        providerMessageId: msg.providerMessageId,
      },
      options.countBucket,
    );
    if (count !== null && count >= MAX_COUNTED_INGEST_FAILURES) return quarantined("ingest_failed");
    return "message_failing";
  }

  async function ingestBatch(
    account: MailAccountRecord,
    msgs: readonly RawInboundMessage[],
    rejected: readonly RejectedInboundMessage[],
    cursorSnapshot: string,
    options: IngestBatchOptions = {},
  ): Promise<IngestBatchOutcome> {
    let quarantinedNew = 0;
    let storageUnavailable = false;
    let storageHealthy = false;
    const outcome = (blocked?: IngestBlockedReason): IngestBatchOutcome => ({
      quarantinedNew,
      storageUnavailable,
      storageHealthy,
      ...(blocked && { blocked }),
    });
    for (const entry of rejected) {
      if (
        await quarantine(
          account,
          entry.providerMessageId,
          "unparseable",
          headerOnlyOfRejected(entry),
        )
      ) {
        quarantinedNew += 1;
      }
    }
    for (const msg of msgs) {
      const result = await attempt(account, msg, cursorSnapshot);
      if (result.kind === "ingested") {
        await clearIngestFailures(deps.db, account.id, [msg.providerMessageId]);
        if (result.storage === "unavailable") storageUnavailable = true;
        if (result.storage === "stored") storageHealthy = true;
        continue;
      }
      const settled = await settleFailure(account, msg, result.kind, options);
      if (settled === "new") quarantinedNew += 1;
      else if (settled !== "known") return outcome(settled);
    }
    return outcome();
  }

  return { ingestBatch };
}
