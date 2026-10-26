// Per-message ingest for the sync supervisor. Every message is isolated: a poison mail must not
// block the cursor of its mailbox, but a systemic outage (database, KMS, file storage) must not
// quarantine good mail either.
//
//   - permanent rejection (validation/unprocessable) -> quarantine immediately, continue
//   - anything else -> the batch aborts before the cursor is saved. The failure only counts once a
//     later mail of the batch succeeded (so it is mail-specific); the third counted failure of the
//     same message quarantines it as "ingest_failed"
//   - provider-side parse failures (`rejected`) -> quarantine "unparseable"

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { errorCodeOf, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { InboundMailFoundationHandlers } from "./constants.ts";
import { normalizeRawInboundMessage } from "./normalize-inbound-message.ts";
import { quarantineMessage } from "./quarantine.ts";
import type { QuarantineReasonCode } from "./quarantine-entities.ts";
import type { MailAccountRecord, RawInboundMessage, RejectedInboundMessage } from "./types.ts";

const MAX_TRANSIENT_FAILURES_PER_MESSAGE = 3;
const PERMANENT_ERROR_CODES: ReadonlySet<string> = new Set(["validation_error", "unprocessable"]);

export type DispatchWrite = (args: {
  readonly handlerQn: string;
  readonly payload: unknown;
  readonly tenantId: string;
}) => Promise<{ readonly isSuccess: boolean; readonly data?: unknown; readonly error?: unknown }>;

export type IngestBatchOutcome = {
  readonly quarantinedNew: number;
  /** True when a message needed file storage and none was available. */
  readonly storageUnavailable: boolean;
  /** True when at least one message with stored content went through. */
  readonly storageHealthy: boolean;
};

export type MessageIngester = {
  readonly ingestBatch: (
    account: MailAccountRecord,
    msgs: readonly RawInboundMessage[],
    rejected: readonly RejectedInboundMessage[],
    cursorSnapshot: string,
  ) => Promise<IngestBatchOutcome>;
};

type IngesterDeps = {
  readonly db: DbConnection;
  readonly dispatchWrite: DispatchWrite;
  readonly storeBody?: (account: MailAccountRecord, msg: RawInboundMessage) => Promise<string>;
  readonly log: (line: string) => void;
};

function isPermanentRejection(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code !== undefined && PERMANENT_ERROR_CODES.has(code);
}

export function createMessageIngester(deps: IngesterDeps): MessageIngester {
  const failures = new Map<string, number>();

  async function quarantine(
    account: MailAccountRecord,
    providerMessageId: string,
    reason: QuarantineReasonCode,
  ): Promise<boolean> {
    const created = await quarantineMessage(
      deps.db,
      { tenantId: account.tenantId, accountId: account.id, providerMessageId },
      reason,
    );
    // Ids only: subject and sender of a poison mail stay out of logs.
    deps.log(`inbound-mail: account ${account.id} quarantined a message (${reason})`);
    return created;
  }

  async function ingestOne(
    account: MailAccountRecord,
    raw: RawInboundMessage,
    cursorSnapshot: string,
  ): Promise<Awaited<ReturnType<DispatchWrite>>> {
    const msg = normalizeRawInboundMessage(raw);
    const bodyRef = deps.storeBody && raw.rawMime ? await deps.storeBody(account, raw) : "";
    return deps.dispatchWrite({
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
        bodyText: msg.bodyText,
        bodyTextTruncated: msg.bodyTextTruncated,
        ...(msg.rawMime != null && { rawMime: msg.rawMime }),
        ...(msg.bodyHtml !== null && { bodyHtml: msg.bodyHtml }),
        attachments: msg.attachments,
        skippedAttachments: msg.skippedAttachments,
        ...(msg.senderAuthentication !== undefined && {
          senderAuthentication: msg.senderAuthentication,
        }),
      },
    });
  }

  type Suspect = { readonly providerMessageId: string; readonly failureKey: string };

  type Attempt =
    | { readonly kind: "ingested"; readonly storage: unknown }
    | { readonly kind: "permanent" }
    | { readonly kind: "failed" };

  async function attempt(
    account: MailAccountRecord,
    msg: RawInboundMessage,
    cursorSnapshot: string,
  ): Promise<Attempt> {
    let failure: unknown;
    try {
      const result = await ingestOne(account, msg, cursorSnapshot);
      if (result.isSuccess)
        return { kind: "ingested", storage: propertyOf(result.data, "contentStorage") };
      failure = result.error ?? {};
    } catch (err) {
      failure = err;
    }
    return { kind: isPermanentRejection(failure) ? "permanent" : "failed" };
  }

  /** A later mail went through, so the earlier failures are mail-specific: count them. */
  async function countSuspects(
    account: MailAccountRecord,
    suspects: readonly Suspect[],
  ): Promise<{ readonly quarantined: number; readonly unresolved: number }> {
    let quarantined = 0;
    let unresolved = 0;
    for (const suspect of suspects) {
      const count = (failures.get(suspect.failureKey) ?? 0) + 1;
      if (count < MAX_TRANSIENT_FAILURES_PER_MESSAGE) {
        failures.set(suspect.failureKey, count);
        unresolved += 1;
        continue;
      }
      failures.delete(suspect.failureKey);
      if (await quarantine(account, suspect.providerMessageId, "ingest_failed")) quarantined += 1;
    }
    return { quarantined, unresolved };
  }

  async function ingestBatch(
    account: MailAccountRecord,
    msgs: readonly RawInboundMessage[],
    rejected: readonly RejectedInboundMessage[],
    cursorSnapshot: string,
  ): Promise<IngestBatchOutcome> {
    let quarantinedNew = 0;
    let storageUnavailable = false;
    let storageHealthy = false;
    for (const entry of rejected) {
      if (await quarantine(account, entry.providerMessageId, "unparseable")) quarantinedNew += 1;
    }
    // Non-permanent failures are only counted once a later mail of the batch went through: then
    // the failure is specific to that mail. Without such a successor it may be an outage (KMS,
    // file storage, database) and must never push good mail towards quarantine.
    let unproven: Suspect[] = [];
    let unresolved = 0;
    for (const msg of msgs) {
      const failureKey = `${account.id}:${msg.providerMessageId}`;
      const outcome = await attempt(account, msg, cursorSnapshot);
      if (outcome.kind === "failed") {
        unproven.push({ providerMessageId: msg.providerMessageId, failureKey });
        continue;
      }
      if (outcome.kind === "permanent") {
        if (await quarantine(account, msg.providerMessageId, "invalid_message"))
          quarantinedNew += 1;
        continue;
      }
      failures.delete(failureKey);
      if (outcome.storage === "unavailable") storageUnavailable = true;
      if (outcome.storage === "stored") storageHealthy = true;
      const counted = await countSuspects(account, unproven);
      quarantinedNew += counted.quarantined;
      unresolved += counted.unresolved;
      unproven = [];
    }
    if (unproven.length > 0 || unresolved > 0) {
      // The cursor is never saved behind a mail that is neither ingested nor quarantined; the next
      // tick refetches and the seen anchors skip what already went through.
      throw new Error(
        `ingest-message failed for account ${account.id}: ${unproven.length} mail(s) without a successful successor, ${unresolved} below the quarantine threshold`,
      );
    }
    return { quarantinedNew, storageUnavailable, storageHealthy };
  }

  return { ingestBatch };
}
