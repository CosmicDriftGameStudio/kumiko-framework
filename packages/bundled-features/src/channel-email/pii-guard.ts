import { PII_CIPHERTEXT_PREFIX } from "@cosmicdrift/kumiko-framework/crypto";
import type { EmailMessage, EmailTransport } from "./types";

const isProductionEnv = () => process.env["NODE_ENV"] === "production";
const CIPHERTEXT_RE = /kumiko-pii:v1:[^"\s<>\\]*/g;

// A PII ciphertext never belongs in an outgoing mail. A ciphertext RECIPIENT
// is always refused (the address is garbage — better no mail than a leaked
// blob); ciphertext in subject/body fails loud in dev and is redacted+logged
// in prod.
export function guardEmailMessage(message: EmailMessage): EmailMessage {
  if (message.to.includes(PII_CIPHERTEXT_PREFIX)) {
    throw new Error(
      "[channel-email] refusing to send: recipient address is a PII ciphertext " +
        `("${PII_CIPHERTEXT_PREFIX}…") — decrypt the stored value before mailing (decryptStoredPii).`,
    );
  }
  const leaking =
    message.subject.includes(PII_CIPHERTEXT_PREFIX) || message.html.includes(PII_CIPHERTEXT_PREFIX);
  if (!leaking) return message;
  const detail =
    "[channel-email] mail subject/body contains a PII ciphertext " +
    `("${PII_CIPHERTEXT_PREFIX}…") — decrypt the stored value before rendering.`;
  if (!isProductionEnv()) throw new Error(detail);
  // biome-ignore lint/suspicious/noConsole: operator-visibility for a redacted prod leak
  console.error(detail);
  return {
    ...message,
    subject: message.subject.replace(CIPHERTEXT_RE, "[pii-redacted]"),
    html: message.html.replace(CIPHERTEXT_RE, "[pii-redacted]"),
  };
}

export function withPiiCiphertextGuard(transport: EmailTransport): EmailTransport {
  return { ...transport, send: async (message) => transport.send(guardEmailMessage(message)) };
}
