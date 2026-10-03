// Leaf module (no engine imports) so bun-db and the executors can sniff PII
// ciphertext without pulling the KMS/pipeline graph into an import cycle.
export const PII_CIPHERTEXT_PREFIX_V1 = "kumiko-pii:v1:";
export const PII_CIPHERTEXT_PREFIX = "kumiko-pii:v2:";
export const PII_CIPHERTEXT_PREFIX_JSON = "kumiko-pii:v3:";

export function isPiiCiphertext(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value.startsWith(PII_CIPHERTEXT_PREFIX) ||
      value.startsWith(PII_CIPHERTEXT_PREFIX_JSON) ||
      value.startsWith(PII_CIPHERTEXT_PREFIX_V1))
  );
}
