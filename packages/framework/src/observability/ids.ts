// OTel trace and span ID generation. Sticks to the spec shape so external
// collectors and UIs understand what we emit:
//   - traceId: 16 random bytes, rendered as 32 lowercase hex chars
//   - spanId:   8 random bytes, rendered as 16 lowercase hex chars
import { bytesToHex } from "../utils/hex.ts";

export function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
