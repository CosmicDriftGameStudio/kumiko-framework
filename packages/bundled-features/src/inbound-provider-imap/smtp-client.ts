// nodemailer wiring for sending from a connected mailbox: one short-lived, non-pooled connection
// per call, always implicit TLS, pinned to the address the mail host guard approved.

import {
  BlockedHostError,
  type MailConnectTarget,
  resolveMailConnectTarget,
} from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { errorCodeOf, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { createTransport, type Transporter } from "nodemailer";
import { imapMailHostGuard } from "./imap-client.ts";

const log = createFallbackLogger("inbound-provider-imap");

// nodemailer's defaults wait minutes; the connect form holds a request open meanwhile.
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 30_000;

export type SmtpLogin = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
};

export type SmtpFailure =
  | "hostUnreachable"
  | "loginRejected"
  | "tlsFailed"
  | "connectFailed"
  | "rejected";

// Carries only the category and the library code: the raw error holds the host and the server
// response, which stay in the server log.
export class SmtpFailureError extends Error {
  readonly failure: SmtpFailure;
  constructor(failure: SmtpFailure, detail: string) {
    super(`SMTP ${failure}: ${detail}`);
    this.name = "SmtpFailureError";
    this.failure = failure;
  }
}

const LOGIN_CODES = ["EAUTH", "ENOAUTH"];
const CONNECTION_CODES = ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "EPROXY"];
const TLS_CODE = /^(ETLS|ERR_SSL|ERR_TLS)|CERT|SELF_SIGNED|UNABLE_TO_VERIFY/;

// nodemailer wraps a TLS handshake error as ESOCKET and keeps the TLS code as originalCode.
function isTlsFailure(code: string, originalCode: unknown): boolean {
  return TLS_CODE.test(code) || (typeof originalCode === "string" && TLS_CODE.test(originalCode));
}

export function classifySmtpError(err: unknown): SmtpFailure {
  const code = errorCodeOf(err) ?? "";
  if (LOGIN_CODES.includes(code)) return "loginRejected";
  if (isTlsFailure(code, propertyOf(err, "originalCode"))) return "tlsFailed";
  if (CONNECTION_CODES.includes(code)) return "connectFailed";
  if (typeof propertyOf(err, "responseCode") === "number") return "rejected";
  return "connectFailed";
}

export function smtpTransportOptions(login: SmtpLogin, target: MailConnectTarget) {
  return {
    host: target.host,
    port: login.port,
    secure: true,
    ...(target.servername && { servername: target.servername }),
    auth: { user: login.user, pass: login.password },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    // The message is composed by us; nothing in it may make nodemailer read files or URLs.
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  } as const;
}

async function openSmtpTransport(login: SmtpLogin): Promise<Transporter> {
  let target: MailConnectTarget;
  try {
    target = await resolveMailConnectTarget(login.host, imapMailHostGuard());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const blocked = err instanceof BlockedHostError;
    log.warn(blocked ? "rejected blocked smtp host" : "smtp host resolution failed", {
      host: login.host,
      reason,
    });
    throw new SmtpFailureError("hostUnreachable", blocked ? "blocked" : "unresolved");
  }
  return createTransport(smtpTransportOptions(login, target));
}

// No error message in the log: a server's reply to a failed AUTH can echo the user name.
function smtpFailureOf(err: unknown, host: string): SmtpFailureError {
  const failure = classifySmtpError(err);
  const code = errorCodeOf(err) ?? "unknown";
  const responseCode = propertyOf(err, "responseCode");
  log.warn("smtp call failed", { host, failure, code, responseCode });
  return new SmtpFailureError(failure, code);
}

export async function verifySmtpLogin(login: SmtpLogin): Promise<void> {
  const transport = await openSmtpTransport(login);
  try {
    await transport.verify();
  } catch (err) {
    throw smtpFailureOf(err, login.host);
  } finally {
    transport.close();
  }
}

export async function sendRawViaSmtp(
  login: SmtpLogin,
  envelope: { readonly from: string; readonly to: readonly string[] },
  raw: Buffer,
): Promise<void> {
  const transport = await openSmtpTransport(login);
  try {
    await transport.sendMail({ envelope: { from: envelope.from, to: [...envelope.to] }, raw });
  } catch (err) {
    throw smtpFailureOf(err, login.host);
  } finally {
    transport.close();
  }
}
