// imapflow wiring and pure helpers for IMAP providers.
// Reference implementation: /Users/marc/code/doc-o-mat (HEINZ), but uses an
// incremental UIDVALIDITY:lastUid cursor instead of a '1:*' full scan.

import { isIP } from "node:net";
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
  type SyncCursorPayload,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { ImapFlow } from "imapflow";
import type { ImapCredentialDocument } from "./credential-document.ts";

export const IMAP_MAILBOX = "INBOX";

const log = createFallbackLogger("inbound-provider-imap");

// Explicit instead of imapflow's defaults (90 s connect, 16 s greeting, 5 min idle socket): a
// mailbox that stops answering must fail within a poll, not minutes later. The socket timeout
// stays at the library's value because IDLE connections rely on it between server keep-alives.
const IMAP_CONNECTION_TIMEOUT_MS = 20_000;
const IMAP_GREETING_TIMEOUT_MS = 16_000;
const IMAP_SOCKET_TIMEOUT_MS = 5 * 60 * 1000;

// Tenant-visible for both branches below — must not reveal whether the host
// was blocked (private/reserved range) or merely failed to resolve, and
// must never include the host or the underlying error text. Server-side
// detail goes to `log` only.
export const IMAP_HOST_UNREACHABLE_MESSAGE = "IMAP host is not reachable or not allowed";

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
  return new ImapFlow(imapClientOptions(doc, target));
}

// For an IP-literal host imapflow itself sets `servername: false`, which Bun's tls.connect rejects
// ("servername argument must be an string"). Overriding it through `tls` with undefined makes the
// socket connect without SNI; the certificate is still verified against the IP. Not setting the
// option at all (as for SMTP, where nodemailer omits a falsy servername) does not help here.
export function imapClientOptions(
  doc: ImapCredentialDocument,
  target: Awaited<ReturnType<typeof resolveMailConnectTarget>>,
) {
  return {
    host: target.host,
    port: doc.port,
    secure: doc.secure,
    ...(target.servername && { servername: target.servername }),
    ...(isIP(target.host) !== 0 && { tls: { servername: undefined } }),
    auth: doc.password
      ? { user: doc.user, pass: doc.password }
      : { user: doc.user, accessToken: doc.accessToken as string },
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    logger: false as const,
    emitLogs: false,
  };
}

/** Drops the connection when the supervisor abandons the sync, so a hung command does not keep the socket open. */
export function closeOnAbort(client: ImapFlow, signal: AbortSignal | undefined): () => void {
  if (!signal) return () => {};
  const close = () => client.close();
  if (signal.aborted) close();
  signal.addEventListener("abort", close, { once: true });
  return () => signal.removeEventListener("abort", close);
}

/** Server-Fehler → typisierte Foundation-Fehlerklassen (Plan §2). */
// examineInbox opens INBOX with EXAMINE instead of SELECT, so the system check never touches \Recent or flags.
export async function connectOnce(
  doc: ImapCredentialDocument,
  examineInbox: boolean,
): Promise<void> {
  const client = await createImapClient(doc, imapMailHostGuard());
  try {
    await client.connect();
    if (examineInbox) await client.mailboxOpen(IMAP_MAILBOX, { readOnly: true });
  } catch (err) {
    throw mapImapError(err, doc.host);
  } finally {
    await client.logout().catch(() => {});
  }
}

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
