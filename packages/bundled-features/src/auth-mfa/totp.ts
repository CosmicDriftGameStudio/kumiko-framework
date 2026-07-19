// RFC 6238 TOTP on top of node:crypto — no otplib/speakeasy dependency. The
// algorithm is ~20 lines of HMAC-SHA1 + dynamic truncation; pulling in a
// package for it would be the opposite of lazy.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // accept ±1 step (±30s) of clock drift, per the spec's guidance

export function generateTotpSecret(): Buffer {
  return randomBytes(20); // 160 bits — RFC 4226's recommended HOTP secret length
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter % 2 ** 32, 4);

  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const truncated =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);

  return String(truncated % 10 ** DIGITS).padStart(DIGITS, "0");
}

// Exposed for callers that need to derive "the code right now" — the
// enable-confirm/verify UI flows show a live-updating code client-side
// (via their own TOTP lib or a countdown), and tests need a code to submit
// without hand-rolling the HMAC math again.
export function currentTotpCode(secret: Buffer, nowMs: number = Date.now()): string {
  return totpAt(secret, Math.floor(nowMs / 1000));
}

function totpAt(secret: Buffer, epochSeconds: number): string {
  return hotp(secret, Math.floor(epochSeconds / STEP_SECONDS));
}

// Timing-safe across the whole ±WINDOW check, not just the final compare —
// a TOTP code is the same sensitivity class as a password, brute-forceable
// over a public /auth/mfa/verify endpoint without it.
//
// Returns the matched HOTP counter (not just true) so callers can burn it —
// a code accepted once must not verify again within its ±WINDOW validity,
// per RFC 6238 §5.2. Returns `false` on no match, matching the old boolean
// contract for callers (like enable-confirm) that don't need replay-burn.
export function verifyTotp(
  secret: Buffer,
  code: string,
  nowMs: number = Date.now(),
): number | false {
  if (!/^\d{6}$/.test(code)) return false;
  const codeBuf = Buffer.from(code);
  const nowSeconds = Math.floor(nowMs / 1000);
  let matchedCounter: number | false = false;
  for (let w = -WINDOW; w <= WINDOW; w++) {
    const stepSeconds = nowSeconds + w * STEP_SECONDS;
    const candidate = Buffer.from(totpAt(secret, stepSeconds));
    if (timingSafeEqual(candidate, codeBuf)) {
      matchedCounter = Math.floor(stepSeconds / STEP_SECONDS);
    }
  }
  return matchedCounter;
}
