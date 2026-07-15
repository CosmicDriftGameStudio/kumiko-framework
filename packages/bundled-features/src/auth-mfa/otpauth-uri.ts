import { base32Encode } from "./base32";

// otpauth:// URI per Google Authenticator's key-uri-format (the de facto
// standard every authenticator app implements). The client renders this as
// a QR code (or lets the user type the secret manually) — the server never
// touches QR rendering.
export function buildOtpauthUri(opts: {
  readonly issuer: string;
  readonly accountLabel: string;
  readonly secret: Buffer;
}): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.accountLabel}`);
  const params = new URLSearchParams({
    secret: base32Encode(opts.secret),
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
