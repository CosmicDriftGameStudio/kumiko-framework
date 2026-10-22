// imapflow wiring and pure helpers for IMAP providers.
// Reference implementation: /Users/marc/code/doc-o-mat (HEINZ), but uses an
// incremental UIDVALIDITY:lastUid cursor instead of a '1:*' full scan.

import {
  BlockedHostError,
  type MailHostGuardOptions,
  readAllowedPrivateMailHostsFromEnv,
  resolveMailConnectTarget,
} from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import {
  InboundAuthError,
  InboundCursorInvalidError,
  InboundTransientError,
  type RawInboundMessage,
  type SyncCursorPayload,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { legacyDateToInstant } from "@cosmicdrift/kumiko-framework/time";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { ImapFlow } from "imapflow";
import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import type { ImapCredentialDocument } from "./credential-document.ts";

export const IMAP_MAILBOX = "INBOX";
const SNIPPET_MAX = 300;

const log = createFallbackLogger("inbound-provider-imap");

// Tenant-visible for both branches below — must not reveal whether the host
// was blocked (private/reserved range) or merely failed to resolve, and
// must never include the host or the underlying error text. Server-side
// detail goes to `log` only.
const IMAP_HOST_UNREACHABLE_MESSAGE = "IMAP host is not reachable or not allowed";

// =============================================================================
// Client-Factory + Fehler-Mapping
// =============================================================================

// Operator escape hatch for an internal relay or a dev/test IMAP server
// (greenmail): KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS, the same operator env
// var mail-transport-smtp registers (both share one schema instance, see
// foundation-shared), never a tenant-config value, so a tenant can never
// grant themselves the private-host bypass.
//
// mailHostLookup is a test-only DNS seam — production leaves it undefined,
// so resolveMailConnectTarget uses the real resolver. Module-global state:
// reset it in afterEach/afterAll.
let mailHostLookup: MailHostGuardOptions["lookupFn"];

export function setImapMailHostLookup(fn: MailHostGuardOptions["lookupFn"]): void {
  mailHostLookup = fn;
}

export function imapMailHostGuard(): MailHostGuardOptions {
  return {
    allowedPrivateMailHosts: readAllowedPrivateMailHostsFromEnv(),
    lookupFn: mailHostLookup,
  };
}

// Resolves+pins doc.host before ever touching imapflow — a blocked host
// (private/reserved range) must never reach a connect attempt. Rejection is
// InboundAuthError (no retry, a config problem) vs InboundTransientError for
// a DNS failure (matches mapImapError's ENOTFOUND handling below).
export async function createImapClient(
  doc: ImapCredentialDocument,
  hostGuard: MailHostGuardOptions = {},
): Promise<ImapFlow> {
  let target: Awaited<ReturnType<typeof resolveMailConnectTarget>>;
  try {
    target = await resolveMailConnectTarget(doc.host, hostGuard);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (err instanceof BlockedHostError) {
      log.warn("rejected blocked host", { host: doc.host, reason });
      throw new InboundAuthError(IMAP_HOST_UNREACHABLE_MESSAGE);
    }
    log.warn("host resolution failed", { host: doc.host, reason });
    throw new InboundTransientError(IMAP_HOST_UNREACHABLE_MESSAGE);
  }
  return new ImapFlow({
    host: target.host,
    port: doc.port,
    secure: doc.secure,
    ...(target.servername && { servername: target.servername }),
    auth: doc.password
      ? { user: doc.user, pass: doc.password }
      : { user: doc.user, accessToken: doc.accessToken as string },
    logger: false,
    emitLogs: false,
  });
}

/** Server-Fehler → typisierte Foundation-Fehlerklassen (Plan §2). */
export function mapImapError(err: unknown, host: string): Error {
  // imapflow errors carry the server response in responseText; the
  // message is only "Command failed", so both are included in the match;
  // authenticationFailed is the reliable flag.
  const carrier = isPlainObject(err) ? err : undefined;
  const responseText = typeof carrier?.["responseText"] === "string" ? carrier["responseText"] : "";
  const msg = `${err instanceof Error ? err.message : String(err)} ${responseText}`.trim();
  if (
    carrier?.["authenticationFailed"] === true ||
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

/** Throws InboundCursorInvalidError when UIDVALIDITY changes; the
 *  foundation resets the cursor and performs a full resync within the
 *  backfill window (deduplication catches duplicates). */
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
    // Lib-boundary bridge (Date from imapflow/mailparser) → Temporal;
    // when no date exists, Epoch is the honest marker.
    receivedAtIso: (receivedAt
      ? legacyDateToInstant(receivedAt)
      : Temporal.Instant.fromEpochMilliseconds(0)
    ).toString(),
    rawMime: args.source,
    scope: "inbox",
  };
}
