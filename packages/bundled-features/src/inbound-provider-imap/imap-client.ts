// imapflow-Wiring + pure Helpers des IMAP-Providers.
// Referenz-Impl: /Users/marc/code/doc-o-mat (HEINZ) — aber inkrementeller
// UIDVALIDITY:lastUid-Cursor statt '1:*'-Vollscan.

import {
  InboundAuthError,
  InboundCursorInvalidError,
  InboundTransientError,
  type RawInboundMessage,
  type SyncCursorPayload,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { ImapFlow } from "imapflow";
import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import type { ImapCredentialDocument } from "./credential-document";

export const IMAP_MAILBOX = "INBOX";
const SNIPPET_MAX = 300;

// =============================================================================
// Client-Factory + Fehler-Mapping
// =============================================================================

export function createImapClient(doc: ImapCredentialDocument): ImapFlow {
  return new ImapFlow({
    host: doc.host,
    port: doc.port,
    secure: doc.secure,
    auth: doc.password
      ? { user: doc.user, pass: doc.password }
      : { user: doc.user, accessToken: doc.accessToken as string },
    logger: false,
    emitLogs: false,
  });
}

/** Server-Fehler → typisierte Foundation-Fehlerklassen (Plan §2). */
export function mapImapError(err: unknown, host: string): Error {
  // imapflow-Fehler tragen die Server-Antwort in responseText, die
  // message ist nur "Command failed" — beides in den Match einbeziehen;
  // authenticationFailed ist das verlässliche Flag.
  const carrier = err as { authenticationFailed?: unknown; responseText?: unknown };
  const responseText = typeof carrier?.responseText === "string" ? carrier.responseText : "";
  const msg = `${err instanceof Error ? err.message : String(err)} ${responseText}`.trim();
  if (
    carrier?.authenticationFailed === true ||
    /auth(entication)? failed|invalid credentials|invalid login|LOGIN failed|AUTHENTICATIONFAILED/i.test(
      msg,
    )
  ) {
    return new InboundAuthError(`IMAP auth failed at ${host}: ${msg}`);
  }
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|ECONNRESET|socket|closed/i.test(msg)) {
    return new InboundTransientError(`IMAP ${host} unreachable: ${msg}`);
  }
  return new InboundTransientError(`IMAP ${host}: ${msg}`);
}

// =============================================================================
// Cursor — { uidValidity: string, lastUid: number }
// =============================================================================

export type ImapCursor = { readonly uidValidity: string; readonly lastUid: number };

export function parseImapCursor(cursor: SyncCursorPayload | null): ImapCursor | null {
  if (!cursor) return null;
  const uidValidity = cursor["uidValidity"];
  const lastUid = cursor["lastUid"];
  if (typeof uidValidity !== "string" || typeof lastUid !== "number") return null;
  return { uidValidity, lastUid };
}

/** Wirft InboundCursorInvalidError bei UIDVALIDITY-Wechsel — die
 *  Foundation resettet den Cursor und macht einen Voll-Resync im
 *  Backfill-Fenster (Dedup fängt Dubletten). */
export function assertUidValidity(cursor: ImapCursor | null, serverUidValidity: string): void {
  if (cursor && cursor.uidValidity !== serverUidValidity) {
    throw new InboundCursorInvalidError(
      `UIDVALIDITY changed (${cursor.uidValidity} → ${serverUidValidity}) — full resync required`,
    );
  }
}

// =============================================================================
// Message-Normalisierung → RawInboundMessage
// =============================================================================

function stripAngles(id: string): string {
  return id.replace(/^<|>$/g, "").trim();
}

/** References-Chain normalisieren: mailparser liefert string | string[]
 *  | undefined; fehlt References, trägt In-Reply-To den Thread-Anker. */
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

/** imapflow liefert internalDate je nach Codepfad als Date ODER string
 *  — an der Lib-Boundary auf Date normalisieren. */
export function coerceDate(d: Date | string | undefined): Date | undefined {
  if (d === undefined) return undefined;
  return d instanceof Date ? d : new Date(d);
}

/** providerMessageId: UID ist nur innerhalb einer UIDVALIDITY eindeutig
 *  — beides zusammen ist der stabile Idempotency-Anchor. */
export function buildProviderMessageId(uidValidity: string, uid: number): string {
  return `${uidValidity}:${uid}`;
}

export async function toRawInboundMessage(args: {
  readonly source: Uint8Array;
  readonly uid: number;
  readonly uidValidity: string;
  readonly internalDate: Date | undefined;
}): Promise<RawInboundMessage> {
  const parsed: ParsedMail = await simpleParser(Buffer.from(args.source));
  const messageIdHeader = parsed.messageId ? stripAngles(parsed.messageId) : null;
  const receivedAt = args.internalDate ?? parsed.date;
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
    receivedAtIso: (receivedAt ?? new Date(0)).toISOString(),
    rawMime: args.source,
    scope: "inbox",
  };
}
