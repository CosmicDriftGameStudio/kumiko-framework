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
