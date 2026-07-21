export type SecurityHeadersOption =
  | false
  | {
      /** `Strict-Transport-Security` value, or `false` to omit.
       *  Default: `max-age=31536000; includeSubDomains`. */
      readonly hsts?: string | false;
      /** `X-Frame-Options` value, or `false` to omit. Default: `DENY`.
       *  Apps that must be embeddable (iframe widgets) set `false` and
       *  scope framing via a `csp` frame-ancestors directive instead. */
      readonly frameOptions?: string | false;
      /** `false` omits `X-Content-Type-Options: nosniff`. */
      readonly contentTypeOptions?: false;
      /** `Referrer-Policy` value, or `false` to omit.
       *  Default: `strict-origin-when-cross-origin`. */
      readonly referrerPolicy?: string | false;
      /** `Content-Security-Policy` default for ALL responses. No built-in
       *  default — a wrong CSP breaks app assets, so it stays opt-in.
       *  A per-host CSP from `hostDispatch` wins over this value. */
      readonly csp?: string;
    };

const DEFAULT_HSTS = "max-age=31536000; includeSubDomains";
const DEFAULT_FRAME_OPTIONS = "DENY";
const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";

export function resolveSecurityHeaders(
  option: SecurityHeadersOption | undefined,
): ReadonlyArray<readonly [string, string]> {
  if (option === false) return [];
  const opt = option ?? {};
  const headers: Array<readonly [string, string]> = [];
  const hsts = opt.hsts ?? DEFAULT_HSTS;
  if (hsts !== false) headers.push(["strict-transport-security", hsts]);
  const frameOptions = opt.frameOptions ?? DEFAULT_FRAME_OPTIONS;
  if (frameOptions !== false) headers.push(["x-frame-options", frameOptions]);
  if (opt.contentTypeOptions !== false) headers.push(["x-content-type-options", "nosniff"]);
  const referrerPolicy = opt.referrerPolicy ?? DEFAULT_REFERRER_POLICY;
  if (referrerPolicy !== false) headers.push(["referrer-policy", referrerPolicy]);
  if (opt.csp) headers.push(["content-security-policy", opt.csp]);
  return headers;
}

// Sets each header only when absent so per-response values (e.g. the
// per-host CSP from hostDispatch) always win over the runtime default.
export function withSecurityHeaders(
  handler: (req: Request) => Response | Promise<Response>,
  option: SecurityHeadersOption | undefined,
): (req: Request) => Response | Promise<Response> {
  const defaults = resolveSecurityHeaders(option);
  if (defaults.length === 0) return handler;
  return async (req: Request): Promise<Response> => {
    const res = await handler(req);
    try {
      for (const [name, value] of defaults) {
        if (!res.headers.has(name)) res.headers.set(name, value);
      }
      return res;
    } catch {
      // Immutable-headers Response (e.g. proxied fetch) — re-wrap.
      const headers = new Headers(res.headers);
      for (const [name, value] of defaults) {
        if (!headers.has(name)) headers.set(name, value);
      }
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
  };
}
