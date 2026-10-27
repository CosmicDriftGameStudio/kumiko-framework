// A quarantined mail stays visible: its headers (and the original, when file storage is there) are
// imported as a message without content, marked "unavailable / quarantined". The import is best
// effort: the quarantine row already moves the cursor on, and a retry can still load the content.

import { InboundMailFoundationHandlers } from "./constants.ts";
import { ingestPayloadOf } from "./ingest-payload.ts";
import { INBOUND_MISSING_SENDER, normalizeRawInboundMessage } from "./normalize-inbound-message.ts";
import type { DispatchWrite } from "./supervisor-ingest.ts";
import type { MailAccountRecord, RawInboundMessage, RejectedInboundMessage } from "./types.ts";

const EPOCH_ISO = "1970-01-01T00:00:00Z";

export function headerOnlyOf(msg: RawInboundMessage): RawInboundMessage {
  const { text: _text, html: _html, attachments: _a, skippedAttachments: _s, ...envelope } = msg;
  return { ...envelope, text: "", html: null, attachments: [], skippedAttachments: [] };
}

/** Null when the provider reported no headers for the mail: nothing meaningful to show. */
export function headerOnlyOfRejected(entry: RejectedInboundMessage): RawInboundMessage | null {
  const { headers } = entry;
  if (!headers) return null;
  return {
    providerMessageId: entry.providerMessageId,
    messageIdHeader: headers.messageIdHeader,
    providerThreadId: null,
    references: [],
    from: headers.from === "" ? INBOUND_MISSING_SENDER : headers.from,
    to: headers.to,
    cc: headers.cc,
    subject: headers.subject,
    snippet: "",
    receivedAtIso: headers.receivedAtIso === "" ? EPOCH_ISO : headers.receivedAtIso,
    rawMime: entry.rawMime ?? null,
    scope: "inbox",
  };
}

export async function importQuarantinedHeaders(
  deps: { readonly dispatchWrite: DispatchWrite; readonly log: (line: string) => void },
  account: MailAccountRecord,
  headerOnly: RawInboundMessage | null,
): Promise<void> {
  // skip: no header data to import for this mail
  if (!headerOnly) return;
  try {
    const result = await deps.dispatchWrite({
      handlerQn: InboundMailFoundationHandlers.ingestMessage,
      tenantId: account.tenantId,
      payload: ingestPayloadOf(account, normalizeRawInboundMessage(headerOnly), {
        providerCursor: "quarantine",
        bodyRef: "",
        contentUnavailableReason: "quarantined",
      }),
    });
    if (!result.isSuccess) {
      deps.log(
        `inbound-mail: account ${account.id} header import of a quarantined mail was rejected`,
      );
    }
  } catch {
    deps.log(`inbound-mail: account ${account.id} header import of a quarantined mail failed`);
  }
}
