import { createHash } from "node:crypto";

export const PDF_MIME_TYPE = "application/pdf";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
