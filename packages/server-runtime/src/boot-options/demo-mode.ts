import type { ExtraRouteDefinition } from "@cosmicdrift/kumiko-framework/api";

export type DemoAccountRole = "admin" | "sysadmin";

/** A role alone, or a role with the label the banner shows next to the login. */
export type DemoAccountEntry =
  | DemoAccountRole
  | { readonly role: DemoAccountRole; readonly label?: Readonly<Record<string, string>> };

/** What `GET /demo-mode` tells the client to show. Every field is optional. */
export type DemoModeNotice = {
  /** Banner text per locale, e.g. `{ de: "…", en: "…" }`. */
  readonly text?: Readonly<Record<string, string>>;
  readonly links?: readonly {
    readonly label: Readonly<Record<string, string>>;
    readonly href: string;
  }[];
  /** Demo logins to publish, read from `DEMO_ADMIN_*` / `DEMO_SYSADMIN_*`.
   *  Published only while `readOnly` is true. Default: none — the route is
   *  anonymous, so listing an account hands its password to every visitor. */
  readonly accounts?: readonly DemoAccountEntry[];
};

/** Live-demo switch. `readOnly: true` answers every mutating request
 *  (POST/PUT/PATCH/DELETE) outside `/api/query` and the login/logout/MFA
 *  routes with 403 `demo_read_only`. `GET /demo-mode` (anonymous) returns
 *  `{ readOnly, notice }` for the client banner.
 *
 *  @example
 *  runProdApp({ ..., demoMode: {
 *    readOnly: env.DEMO_READ_ONLY === "true",
 *    notice: { text: { en: "Read-only demo" }, accounts: ["admin"] },
 *  } })
 */
export type DemoModeOption = {
  readonly readOnly: boolean;
  readonly notice?: DemoModeNotice;
  /** Mutating paths that stay open besides the default allowlist. */
  readonly allowedWritePaths?: readonly string[];
};

export const DEMO_MODE_PATH = "/demo-mode";
export const DEMO_READ_ONLY_ERROR_CODE = "demo_read_only";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_ALLOWED_WRITE_PATHS = [
  "/api/query",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/mfa/verify",
] as const;

const ACCOUNT_ENV_KEYS: Readonly<
  Record<DemoAccountRole, { readonly email: string; readonly password: string }>
> = {
  admin: { email: "DEMO_ADMIN_EMAIL", password: "DEMO_ADMIN_PASSWORD" },
  sysadmin: { email: "DEMO_SYSADMIN_EMAIL", password: "DEMO_SYSADMIN_PASSWORD" },
};

export type DemoModePayload = {
  readonly readOnly: boolean;
  readonly notice: {
    readonly text?: Readonly<Record<string, string>>;
    readonly links?: DemoModeNotice["links"];
    readonly accounts: readonly {
      readonly role: DemoAccountRole;
      readonly label?: Readonly<Record<string, string>>;
      readonly email: string;
      readonly password: string;
    }[];
  };
};

export function buildDemoModePayload(
  demoMode: DemoModeOption,
  envSource: Record<string, string | undefined>,
): DemoModePayload {
  const accounts = demoMode.readOnly
    ? (demoMode.notice?.accounts ?? []).flatMap((entry) => {
        const { role, label } =
          typeof entry === "string" ? { role: entry, label: undefined } : entry;
        const keys = ACCOUNT_ENV_KEYS[role];
        const email = envSource[keys.email];
        const password = envSource[keys.password];
        return email && password
          ? [{ role, ...(label !== undefined && { label }), email, password }]
          : [];
      })
    : [];
  return {
    readOnly: demoMode.readOnly,
    notice: {
      ...(demoMode.notice?.text && { text: demoMode.notice.text }),
      ...(demoMode.notice?.links && { links: demoMode.notice.links }),
      accounts,
    },
  };
}

export function buildDemoModeRoute(
  demoMode: DemoModeOption,
  envSource: Record<string, string | undefined>,
): ExtraRouteDefinition {
  const payload = buildDemoModePayload(demoMode, envSource);
  return {
    method: "GET",
    path: DEMO_MODE_PATH,
    entry: "anonymous",
    handler: (c) => c.json(payload),
  };
}

/** Wraps the app fetch handler; the second argument (socket address) is
 *  passed through so client-IP rate limits keep working behind the gate. */
export function withDemoReadOnlyFetch<TArg>(
  fetchHandler: (req: Request, arg?: TArg) => Promise<Response>,
  demoMode: DemoModeOption,
): (req: Request, arg?: TArg) => Promise<Response> {
  // skip: no read-only gate requested, keep the handler untouched
  if (!demoMode.readOnly) return fetchHandler;
  const allowed = new Set<string>([
    ...DEFAULT_ALLOWED_WRITE_PATHS,
    ...(demoMode.allowedWritePaths ?? []),
  ]);
  return async (req, arg) => {
    if (MUTATING_METHODS.has(req.method) && !allowed.has(new URL(req.url).pathname)) {
      return Response.json(
        {
          isSuccess: false,
          error: {
            code: DEMO_READ_ONLY_ERROR_CODE,
            message: "This live demo is read-only.",
            i18nKey: "errors.demoReadOnly",
          },
        },
        { status: 403 },
      );
    }
    return fetchHandler(req, arg);
  };
}
