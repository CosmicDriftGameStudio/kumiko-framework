import type {
  RawInboundMessage,
  RejectedInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { legacyDateToInstant } from "@cosmicdrift/kumiko-framework/time";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { MessageEnvelopeObject } from "imapflow";
import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import { extractMailContent } from "./mime-content.ts";
import { senderAuthenticationOf } from "./sender-auth-headers.ts";

const SNIPPET_MAX = 300;

const log = createFallbackLogger("inbound-provider-imap");

// =============================================================================
// Message-Normalisierung → RawInboundMessage
// =============================================================================

function stripAngles(id: string): string {
  return id.replace(/^<|>$/g, "").trim();
}

/** Normalizes the References chain: mailparser returns string | string[]
 *  | undefined; when References is missing, In-Reply-To provides the thread
 *  anchor. */
export function normalizeReferences(parsed: {
  references?: string | string[];
  inReplyTo?: string;
}): string[] {
  const raw = parsed.references;
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : raw.split(/\s+/);
  const refs = list.map(stripAngles).filter((r) => r.length > 0);
  if (refs.length === 0 && parsed.inReplyTo) {
    const inReplyTo = stripAngles(parsed.inReplyTo);
    if (inReplyTo) return [inReplyTo];
  }
  return refs;
}

function addressList(a: AddressObject | AddressObject[] | undefined): string[] {
  if (!a) return [];
  const arr = Array.isArray(a) ? a : [a];
  return arr.map((x) => x.text).filter((t): t is string => Boolean(t));
}

/** imapflow provides internalDate as either a Date or string depending on
 *  the code path. The string form is deliberately discarded (no date parsing
 *  in feature code, no-date-api); toRawInboundMessage then falls back to the
 *  mailparser Date header, which is always a real Date. */
export function coerceDate(d: Date | string | undefined): Date | undefined {
  return d instanceof Date ? d : undefined;
}

/** providerMessageId: a UID is unique only within a UIDVALIDITY; together,
 *  they form the stable idempotency anchor. */
export function buildProviderMessageId(uidValidity: string, uid: number): string {
  return `${uidValidity}:${uid}`;
}

export async function toRawInboundMessage(args: {
  readonly source: Uint8Array;
  readonly uid: number;
  readonly uidValidity: string;
  readonly internalDate: Date | undefined;
  /** IMAP envelope; lets a mail that cannot be parsed still show sender and subject. */
  readonly envelope?: MessageEnvelopeObject | undefined;
  /** authserv-id of the mailbox's own server; without it senderAuthentication is null. */
  readonly trustedAuthservId?: string | null;
}): Promise<RawInboundMessage> {
  const parsed: ParsedMail = await simpleParser(Buffer.from(args.source));
  const messageIdHeader = parsed.messageId ? stripAngles(parsed.messageId) : null;
  const receivedAt = args.internalDate ?? parsed.date;
  const content = await extractMailContent(parsed);
  const text = parsed.text?.trim() ?? "";
  return {
    providerMessageId: buildProviderMessageId(args.uidValidity, args.uid),
    messageIdHeader: messageIdHeader && messageIdHeader.length > 0 ? messageIdHeader : null,
    providerThreadId: null,
    references: normalizeReferences(parsed),
    from: parsed.from?.text ?? "",
    to: addressList(parsed.to),
    cc: addressList(parsed.cc),
    subject: parsed.subject ?? "",
    snippet: text.slice(0, SNIPPET_MAX),
    // Lib-boundary bridge (Date from imapflow/mailparser) → Temporal;
    // when no date exists, Epoch is the honest marker.
    receivedAtIso: (receivedAt
      ? legacyDateToInstant(receivedAt)
      : Temporal.Instant.fromEpochMilliseconds(0)
    ).toString(),
    text: content.text,
    ...(content.html !== null && { html: content.html }),
    attachments: content.attachments,
    skippedAttachments: content.skipped,
    senderAuthentication: senderAuthenticationOf(parsed, args.trustedAuthservId ?? null),
    rawMime: args.source,
    scope: "inbox",
  };
}

function envelopeAddresses(list: MessageEnvelopeObject["to"]): string[] {
  return (list ?? []).map((a) => a.address ?? "").filter((a) => a !== "");
}

function headersOfEnvelope(
  envelope: MessageEnvelopeObject,
  internalDate: Date | undefined,
): NonNullable<RejectedInboundMessage["headers"]> {
  const sender = envelope.from?.[0];
  const receivedAt = internalDate ?? coerceDate(envelope.date);
  return {
    from: sender?.address ?? "",
    to: envelopeAddresses(envelope.to),
    cc: envelopeAddresses(envelope.cc),
    subject: envelope.subject ?? "",
    messageIdHeader: envelope.messageId ? stripAngles(envelope.messageId) : null,
    receivedAtIso: receivedAt ? legacyDateToInstant(receivedAt).toString() : "",
  };
}

export type ParsedOrRejected =
  | { readonly message: RawInboundMessage }
  | { readonly rejected: RejectedInboundMessage };

/** A mail the MIME parser cannot handle must not stop the mailbox: it is reported as rejected so the
 *  foundation quarantines it and the cursor moves on. */
export async function parseOrReject(
  args: Parameters<typeof toRawInboundMessage>[0],
): Promise<ParsedOrRejected> {
  try {
    return { message: await toRawInboundMessage(args) };
  } catch (err) {
    // Class name only: parser messages can quote header content.
    log.warn("mail could not be parsed", {
      uid: args.uid,
      error: err instanceof Error ? err.name : typeof err,
    });
    return {
      rejected: {
        providerMessageId: buildProviderMessageId(args.uidValidity, args.uid),
        reason: "unparseable",
        rawMime: args.source,
        ...(args.envelope && { headers: headersOfEnvelope(args.envelope, args.internalDate) }),
      },
    };
  }
}
