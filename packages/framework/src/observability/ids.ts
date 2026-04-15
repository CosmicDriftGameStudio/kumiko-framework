// OTel trace and span ID generation. Sticks to the spec shape so external
// collectors and UIs understand what we emit:
//   - traceId: 16 random bytes, rendered as 32 lowercase hex chars
//   - spanId:   8 random bytes, rendered as 16 lowercase hex chars

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

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
