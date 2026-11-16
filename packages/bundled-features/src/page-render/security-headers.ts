// default-src 'none' closes every fetch the pages do not need; fonts, styles and
// images stay same-origin (images also https/data for branding logos and markdown).
const PUBLIC_PAGE_CSP_DIRECTIVES = {
  "default-src": "'none'",
  "script-src": "'none'",
  "object-src": "'none'",
  "base-uri": "'none'",
  "img-src": "'self' https: data:",
  "style-src": "'self' 'unsafe-inline'",
  "font-src": "'self'",
  "form-action": "'none'",
  "frame-ancestors": "'self'",
} as const;

type PublicPageCspOverrides = Readonly<Partial<Record<"form-action" | "frame-ancestors", string>>>;

function publicPageCsp(overrides: PublicPageCspOverrides): string {
  const directives: Record<string, string> = { ...PUBLIC_PAGE_CSP_DIRECTIVES };
  // An explicit undefined keeps the default: without form-action or
  // frame-ancestors everything is allowed, they do not fall back to default-src.
  for (const [directive, sources] of Object.entries(overrides)) {
    if (sources !== undefined) directives[directive] = sources;
  }
  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources}`)
    .join("; ");
}

const PUBLIC_PAGE_HARDENING_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
} as const;

// Security headers spread LAST so a caller's `extra` can never override a
// hardened default (CSP/nosniff/frame-options); extra only adds non-security
// headers like content-type/cache-control/vary. Only the typed cspOverrides may
// relax form-action/frame-ancestors.
export function securePageHeaders(
  extra: Record<string, string>,
  cspOverrides: PublicPageCspOverrides = {},
): Record<string, string> {
  return {
    ...extra,
    ...PUBLIC_PAGE_HARDENING_HEADERS,
    "content-security-policy": publicPageCsp(cspOverrides),
  };
}
