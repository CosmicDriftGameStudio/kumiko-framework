// Security headers for server-rendered public HTML pages (legal-pages,
// managed-pages). `script-src 'none'` provides defense in depth: even if
// HTML injection gets through, no script can run. Deliberately omit
// `default-src` so styles, images, and fonts remain unrestricted for
// backward compatibility with inline-<style> layouts such as
// publicstatus' renderLegalLayout.
// nosniff/SAMEORIGIN/Referrer-Policy are broadly safe defaults.
const PUBLIC_PAGE_SECURITY_HEADERS = {
  "content-security-policy": "script-src 'none'; object-src 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
} as const;

// Security headers spread LAST so a caller's `extra` can never override a
// hardened default (CSP/nosniff/frame-options); extra only adds non-security
// headers like content-type/cache-control/vary.
export function securePageHeaders(extra: Record<string, string>): Record<string, string> {
  return { ...extra, ...PUBLIC_PAGE_SECURITY_HEADERS };
}
