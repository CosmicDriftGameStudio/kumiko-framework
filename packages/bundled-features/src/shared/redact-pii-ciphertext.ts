import { isPiiCiphertext } from "@cosmicdrift/kumiko-framework/crypto";

export const REDACTED_PII_PLACEHOLDER = "[[personal data]]" as const;

// Event payloads store PII fields as subject-KMS ciphertext; the API leak guard
// rejects any response carrying it, so payload reads swap it for a placeholder.
export function redactPiiCiphertext(value: unknown): unknown {
  if (isPiiCiphertext(value)) return REDACTED_PII_PLACEHOLDER;
  if (Array.isArray(value)) return value.map(redactPiiCiphertext);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, redactPiiCiphertext(inner)]),
    );
  }
  return value;
}
