// SMTP transport for the EmailTransport interface, based on nodemailer
// (battle-tested, handles TLS, auth and pool reconnects). It is the universal
// default for apps that do not need a vendor-specific sender and works with
// any SMTP server (Gmail, a private
// Postfix server, a Brevo SMTP relay, Office 365, or Mailhog for local
// testing).
//
// Why SMTP instead of a vendor API as the default:
//   1. EU data control: the app owner chooses the server instead of sending
//      data to a US vendor.
//   2. Self-hosting: customers can use their own mail server without an
//      external account.
//   3. Universality: every vendor (Brevo, Resend, Mailgun, Postmark) also
//      offers SMTP, so Brevo users can provide Brevo SMTP credentials.
//
// The transport pool (createTransport({ pool: true })) keeps up to 5
// connections open and reuses them. That is enough for small apps; for
// high-volume apps the caller must layer its own implementation with a
// dedicated queue (BullMQ + retry) on top.

import { createTransport, type Transporter } from "nodemailer";
import addressparser from "nodemailer/lib/addressparser";
import type { EmailAttachment, EmailMessage, EmailTransport } from "./types.ts";

export type SmtpTransportOptions = {
  /** SMTP server host (for example, "smtp.gmail.com", "in-v3.mailjet.com",
   *  or "localhost" for Mailhog/MailCatcher in development). */
  readonly host: string;
  /** Default 587 (STARTTLS). 465 uses implicit TLS; 25 is unencrypted
   *  (for local/internal use only, never public). */
  readonly port?: number;
  /** TLS mode: true = implicit TLS on port 465, false = STARTTLS on
   *  587 (or plain on 25). The default is false (STARTTLS). */
  readonly secure?: boolean;
  /** Optional authentication — some internal relays use IP allowlisting
   *  instead of login. When set, both fields are required. */
  readonly auth?: {
    readonly user: string;
    readonly pass: string;
  };
  /** App-wide default From. A single send can override it via
   *  `EmailMessage.from` (reply from a specific mailbox); without an
   *  override this applies. Accepts both "noreply@ex.com" and
   *  "Name <noreply@ex.com>". */
  readonly from: string;
  /** TLS SNI hostname. Only needed when `host` is an IP address pinned by
   *  the caller for a hostname it already resolved — nodemailer otherwise
   *  skips SNI for an IP `host` and certificate validation would then check
   *  the wrong name. Unset for the common case where `host` is already the
   *  hostname to validate against. */
  readonly servername?: string;
};

function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}

// Mail clients often show only the display name: an embedded address ("<", ">", "@") would
// pass for a foreign sender on the platform's own SPF/DKIM-signed domain.
function isUnsafeDisplayNameCharacter(char: string): boolean {
  return isControlCharacter(char) || char === "<" || char === ">" || char === "@";
}

// Control characters in a display name would let a caller inject headers.
function sanitizedDisplayName(name: string | undefined): string | undefined {
  const cleaned = name
    ?.split("")
    .map((char) => (isUnsafeDisplayNameCharacter(char) ? " " : char))
    .join("")
    .trim();
  return cleaned === undefined || cleaned === "" ? undefined : cleaned;
}

function fromHeader(
  address: string,
  fromName: string | undefined,
): string | { readonly name: string; readonly address: string } {
  const name = sanitizedDisplayName(fromName);
  if (name === undefined) return address;
  const [parsed] = addressparser(address, { flatten: true });
  return parsed?.address ? { name, address: parsed.address } : address;
}

function toNodemailerAttachment(attachment: EmailAttachment) {
  const base = {
    filename: attachment.fileName,
    content: Buffer.from(attachment.content),
    contentType: attachment.contentType,
  };
  return attachment.kind === "inline"
    ? { ...base, cid: attachment.cid, contentDisposition: "inline" as const }
    : base;
}

export function createSmtpTransport(options: SmtpTransportOptions): EmailTransport {
  const transporter: Transporter = createTransport({
    host: options.host,
    port: options.port ?? 587,
    secure: options.secure ?? false,
    ...(options.auth && { auth: options.auth }),
    ...(options.servername && { servername: options.servername }),
    pool: true,
    maxConnections: 5,
  });

  return {
    async send(message: EmailMessage): Promise<void> {
      await transporter.sendMail({
        from: fromHeader(message.from ?? options.from, message.fromName),
        to: message.to,
        subject: message.subject,
        html: message.html,
        ...(message.text !== undefined && { text: message.text }),
        ...(message.replyTo && { replyTo: message.replyTo }),
        ...(message.headers && { headers: message.headers }),
        ...(message.attachments && {
          attachments: message.attachments.map(toNodemailerAttachment),
        }),
      });
    },
  };
}

/** Environment fields read by `createSmtpTransportFromEnv`. Apps that use
 *  SMTP should extend their environment schema with exactly these keys. */
export type SmtpEnv = {
  readonly SMTP_HOST?: string;
  readonly SMTP_PORT?: string;
  readonly SMTP_SECURE?: string;
  readonly SMTP_USER?: string;
  readonly SMTP_PASS?: string;
  readonly SMTP_FROM?: string;
};

/**
 * Creates a transport at boot time from the environment. Without
 * `SMTP_HOST`, returns `null` so the caller can treat this as no mail
 * delivery instead of crashing. The port is coerced to a number (default
 * 587); `secure` is `SMTP_SECURE === "true"`; authentication is included
 * only when both the user and password are set.
 *
 * Replaces the repeated `env.SMTP_HOST ? createSmtpTransport({...}) : null`
 * block that each app previously implemented in bin/main.ts and
 * bin/server.ts. Only the From default (`fallbackFrom`) varies by app.
 */
export function createSmtpTransportFromEnv(
  env: SmtpEnv,
  opts: { readonly fallbackFrom: string },
): EmailTransport | null {
  if (!env.SMTP_HOST) return null;
  return createSmtpTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
    secure: env.SMTP_SECURE === "true",
    ...(env.SMTP_USER && env.SMTP_PASS
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
      : {}),
    from: env.SMTP_FROM ?? opts.fallbackFrom,
  });
}
