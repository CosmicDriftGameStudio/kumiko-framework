// SMTP-Transport für EmailTransport-Interface. nodemailer-basiert
// (battle-tested, TLS-AUTH-Pool-Reconnect handled). Universaler default
// für apps die keinen Vendor-spezifischen Sender wollen — funktioniert
// gegen jeden SMTP-Server (Gmail, eigener Postfix, Brevo-SMTP-relay,
// Office 365, Mailhog für lokales testing).
//
// Why SMTP statt Vendor-API als default:
//   1. EU-Story: kein Daten an US-Vendor, App-Owner wählt Server.
//   2. Self-Hosting: Customer kann eigenen Mailserver nutzen, kein
//      external account.
//   3. Universalität: jeder Vendor (Brevo, Resend, Mailgun, Postmark)
//      bietet auch SMTP — wer Brevo will, setzt Brevos SMTP-Credentials.
//
// Transport-Pool: nodemailer.createTransport({pool: true}) hält bis zu
// 5 Verbindungen offen + reused. Bei kleinen Apps reicht das; für High-
// Volume-Apps muss der Caller eine eigene Implementation mit
// dedizierter Queue (BullMQ + retry) drüberlegen.

import { createTransport, type Transporter } from "nodemailer";
import type { EmailMessage, EmailTransport } from "./types";

export type SmtpTransportOptions = {
  /** SMTP-Server-Host (z.B. "smtp.gmail.com", "in-v3.mailjet.com",
   *  "localhost" für Mailhog/MailCatcher in dev). */
  readonly host: string;
  /** Default 587 (STARTTLS). 465 für implicit-TLS, 25 für unencrypted
   *  (nur lokal/intern, nie public). */
  readonly port?: number;
  /** TLS-Mode: true = implicit TLS auf port 465, false = STARTTLS auf
   *  587 (oder plain auf 25). Default false (STARTTLS standard). */
  readonly secure?: boolean;
  /** Optional auth — manche internal-relays nehmen IP-whitelisting statt
   *  Login. Wenn gesetzt, beide felder pflicht. */
  readonly auth?: {
    readonly user: string;
    readonly pass: string;
  };
  /** Standard-From-Adresse für jede Mail. EmailMessage hat kein from-
   *  Feld — die Auswahl gehört zur Transport-Konfig (App-weit, nicht
   *  pro Mail). Format akzeptiert beides: "noreply@ex.com" oder
   *  "Name <noreply@ex.com>". */
  readonly from: string;
};

export function createSmtpTransport(options: SmtpTransportOptions): EmailTransport {
  const transporter: Transporter = createTransport({
    host: options.host,
    port: options.port ?? 587,
    secure: options.secure ?? false,
    ...(options.auth && { auth: options.auth }),
    pool: true,
    maxConnections: 5,
  });

  return {
    async send(message: EmailMessage): Promise<void> {
      await transporter.sendMail({
        from: options.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
      });
    },
  };
}

/** Env-Felder die `createSmtpTransportFromEnv` liest. Apps die SMTP
 *  nutzen extenden ihr env-Schema um genau diese Keys. */
export type SmtpEnv = {
  readonly SMTP_HOST?: string;
  readonly SMTP_PORT?: string;
  readonly SMTP_SECURE?: string;
  readonly SMTP_USER?: string;
  readonly SMTP_PASS?: string;
  readonly SMTP_FROM?: string;
};

/**
 * Boot-Time-Transport aus env. Ohne `SMTP_HOST` → `null` (Caller behandelt
 * das als "kein Mail-Versand", statt zu crashen). Port wird zu Number
 * gecoerced (default 587), `secure` ist `SMTP_SECURE === "true"`, auth nur
 * wenn user UND pass gesetzt sind.
 *
 * Ersetzt den identischen `env.SMTP_HOST ? createSmtpTransport({...}) : null`
 * Block den jede App in bin/main.ts + bin/server.ts hand-rollte — nur die
 * From-Default (`fallbackFrom`) variiert pro App.
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
