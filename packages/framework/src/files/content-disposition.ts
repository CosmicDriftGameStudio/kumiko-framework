// RFC-6266 + RFC-5987 compliant Content-Disposition builder.
//
// fileName reaches this module from the client's multipart upload — it is
// effectively attacker-controlled. A name like
// `foo.pdf"; filename*=utf-8''evil.exe` would break the `filename="..."`
// header quoting and inject a second parameter if we interpolated the raw
// string. Two-step fix:
//
//   1. ASCII fallback for `filename="..."` — strip anything outside a safe
//      token set, keeping the name readable for legacy clients that don't
//      understand RFC 5987.
//   2. Percent-encoded UTF-8 for `filename*=UTF-8''...` — the modern
//      parameter that every current browser honours. RFC 5987 requires a
//      handful of reserved chars that encodeURIComponent leaves alone
//      ('()*) to also be escaped.
//
// Lives in its own module so the sanitisation is unit-testable in
// isolation — the HTTP route exercises integration; edge cases around
// encoding + fallback live in content-disposition.test.ts.

const MAX_FALLBACK_LENGTH = 100;
const SAFE_FALLBACK_CHARS = /[^A-Za-z0-9.\-_()]/g;
const RFC_5987_EXTRA_ESCAPES = /['()*]/g;

export function buildContentDispositionHeader(fileName: string): string {
  const asciiFallback = toAsciiFallback(fileName);
  const encoded = encodeRFC5987(fileName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

// Collapse everything outside a safe token set (letters, digits, dot, dash,
// underscore, parens) to underscore. Bounded length so a giant client-
// supplied name can't balloon the header.
//
// Falls back to "download" in two cases: (1) the stripped result is empty,
// and (2) nothing alphanumeric survived — a filename like "_______.png" is
// legal but useless. "download" is readable; the original bytes still
// reach the browser losslessly via filename* in the surrounding header.
export function toAsciiFallback(name: string): string {
  const stripped = name.replace(SAFE_FALLBACK_CHARS, "_").slice(0, MAX_FALLBACK_LENGTH);
  if (stripped.length === 0) return "download";
  if (!/[A-Za-z0-9]/.test(stripped)) return "download";
  return stripped;
}

// encodeURIComponent handles the UTF-8 → percent-encoding step but leaves
// a handful of characters unescaped that RFC 5987 calls out as reserved
// ( ' ( ) * ). Escape those explicitly so the output is strictly
// conformant and safe to drop into the `ext-value` production.
export function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    RFC_5987_EXTRA_ESCAPES,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
