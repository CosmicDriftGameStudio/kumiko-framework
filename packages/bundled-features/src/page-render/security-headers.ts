// Security-Header für server-gerenderte Public-HTML-Pages (legal-pages,
// managed-pages). `script-src 'none'` ist Defense-in-Depth: selbst wenn
// HTML-Injection durchrutscht, läuft kein Script. Bewusst KEIN `default-src`
// → Styles/Images/Fonts bleiben unrestricted (rückwärtskompatibel zu
// Inline-<style>-Layouts wie publicstatus' renderLegalLayout).
// nosniff/SAMEORIGIN/Referrer-Policy sind universell sichere Defaults.
const PUBLIC_PAGE_SECURITY_HEADERS = {
  "content-security-policy": "script-src 'none'; object-src 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
} as const;

export function securePageHeaders(extra: Record<string, string>): Record<string, string> {
  return { ...PUBLIC_PAGE_SECURITY_HEADERS, ...extra };
}
