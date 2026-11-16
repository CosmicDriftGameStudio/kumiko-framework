import { isPiiCiphertext } from "@cosmicdrift/kumiko-framework/crypto";

const MASK = "***";
const VISIBLE_TAIL_LENGTH = 4;
const MIN_LENGTH_FOR_VISIBLE_TAIL = 8;

function maskedUrl(address: string): string | undefined {
  if (!URL.canParse(address)) return undefined;
  const url = new URL(address);
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return `${url.origin}/${MASK}`;
}

function maskedEmail(address: string): string | undefined {
  const parts = address.split("@");
  const [local, domain] = parts;
  if (parts.length !== 2 || !local || domain === undefined) return undefined;
  return `${local.charAt(0)}${MASK}@${domain}`;
}

// The attempt log is an audit trail, not a contact list: it keeps enough of the address to
// recognise where a message went, never the full value. URLs go first because webhook URLs can
// contain an "@" and their path carries the secret.
export function maskRecipientAddress(address: string | null): string | null {
  if (address === null) return null;
  return maskPlainAddress(address);
}

function maskPlainAddress(address: string): string {
  // isPiiCiphertext is a type predicate; its false branch would narrow `string` to `never`.
  if (isPiiCiphertext(address)) return MASK;
  return maskStructuredOrTail(address);
}

function maskStructuredOrTail(address: string): string {
  const structured = maskedUrl(address) ?? maskedEmail(address);
  if (structured !== undefined) return structured;
  if (address.length < MIN_LENGTH_FOR_VISIBLE_TAIL) return MASK;
  return `${MASK}${address.slice(-VISIBLE_TAIL_LENGTH)}`;
}
