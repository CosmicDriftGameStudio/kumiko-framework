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
      /** `Content-Security-Policy` for ALL responses.
       *  - omitted: the built-in default (see `DEFAULT_CSP_DIRECTIVES`) with the
       *    inline-script hashes from `dist/csp-hashes.json`.
       *  - `false`: no CSP header.
       *  - string: replaces the default entirely (no hashes are added).
       *  - `{ extend }`: adds sources to the default directives, or new directives.
       *  A per-host CSP from `hostDispatch` wins over this value. */
      readonly csp?: CspOption;
    };

export type CspExtension = Readonly<Record<string, readonly string[]>>;
export type CspOption = false | string | { readonly extend: CspExtension };

const DEFAULT_HSTS = "max-age=31536000; includeSubDomains";
const DEFAULT_FRAME_OPTIONS = "DENY";
const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";

export const DEFAULT_CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:"],
  "connect-src": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
};

const SCRIPT_HASH_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;
const DIRECTIVE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
// Separators that would let an extension value end its own
// directive, start a new one or break out of the header line.
const FORBIDDEN_SOURCE_CHARS = /[;,\s]/;

export function isScriptHash(value: unknown): value is string {
  return typeof value === "string" && SCRIPT_HASH_PATTERN.test(value);
}

function assertValidExtension(extend: CspExtension): void {
  for (const [directive, sources] of Object.entries(extend)) {
    if (!DIRECTIVE_NAME_PATTERN.test(directive)) {
      throw new Error(`[security-headers] csp.extend: invalid directive name "${directive}".`);
    }
    for (const source of sources) {
      if (source.length === 0 || FORBIDDEN_SOURCE_CHARS.test(source)) {
        throw new Error(
          `[security-headers] csp.extend["${directive}"]: source "${source}" must be a single token without whitespace, ";" or ",".`,
        );
      }
    }
  }
}

export function buildDefaultCsp(
  scriptHashes: readonly string[],
  extend: CspExtension = {},
): string {
  assertValidExtension(extend);
  const directives = new Map<string, string[]>(
    Object.entries(DEFAULT_CSP_DIRECTIVES).map(([name, sources]) => [name, [...sources]]),
  );
  directives.get("script-src")?.push(...scriptHashes.map((hash) => `'${hash}'`));
  for (const [name, sources] of Object.entries(extend)) {
    const existing = directives.get(name) ?? [];
    // 'none' is only valid as the sole source, so extending it replaces it.
    const base = existing.length === 1 && existing[0] === "'none'" ? [] : existing;
    directives.set(name, [...new Set([...base, ...sources])]);
  }
  return [...directives].map(([name, sources]) => [name, ...sources].join(" ")).join("; ");
}

function resolveCsp(option: CspOption | undefined, scriptHashes: readonly string[]): string | null {
  if (option === false) return null;
  if (typeof option === "string") return option.length > 0 ? option : null;
  return buildDefaultCsp(scriptHashes, option?.extend);
}

export function resolveSecurityHeaders(
  option: SecurityHeadersOption | undefined,
  scriptHashes: readonly string[] = [],
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
  const csp = resolveCsp(opt.csp, scriptHashes);
  if (csp !== null) headers.push(["content-security-policy", csp]);
  return headers;
}

// Sets each header only when absent so per-response values (e.g. the
// per-host CSP from hostDispatch) always win over the runtime default.
export function withSecurityHeaders<TServeArg = string>(
  handler: (req: Request, serveArg?: TServeArg) => Response | Promise<Response>,
  option: SecurityHeadersOption | undefined,
  scriptHashes: readonly string[] = [],
): (req: Request, serveArg?: TServeArg) => Response | Promise<Response> {
  const defaults = resolveSecurityHeaders(option, scriptHashes);
  if (defaults.length === 0) return handler;
  return async (req: Request, serveArg?: TServeArg): Promise<Response> => {
    const res = await handler(req, serveArg);
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
