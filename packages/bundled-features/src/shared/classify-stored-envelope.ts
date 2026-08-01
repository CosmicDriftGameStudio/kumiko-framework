import { isStoredEnvelope } from "@cosmicdrift/kumiko-framework/secrets";

export type StoredEnvelopeClassification = "rotate" | "current" | "unrecognized";

// Shared by every KEK-rotation job (config, auth-mfa, ...): a row whose value
// isn't a current-cipher envelope (malformed JSON, or any pre-envelope
// format) is never a supported re-encrypt input — classify it "unrecognized"
// so callers fail it loudly instead of handing it to cipher.decrypt.
export function classifyStoredEnvelope(
  value: string,
  targetVersion: number,
): StoredEnvelopeClassification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return "unrecognized";
  }
  if (!isStoredEnvelope(parsed)) return "unrecognized";
  return parsed.kekVersion === targetVersion ? "current" : "rotate";
}
