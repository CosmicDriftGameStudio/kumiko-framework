import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AUTH_COOKIE_BASE,
  CSRF_COOKIE_BASE,
  createClientIpResolver,
  generateToken,
  sessionCookieName,
} from "@cosmicdrift/kumiko-framework/api";
import { rankPreferredLocales } from "@cosmicdrift/kumiko-framework/i18n";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  type PageHeadResolver,
  type PageHeadSystemQuery,
  resolveAndInjectPageHead,
} from "@cosmicdrift/kumiko-renderer/headless/apex";
import { buildRequestBoundSystemQuery } from "@cosmicdrift/kumiko-server-runtime/request-bound-system-query";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { NormalizedEntry } from "./create-kumiko-server-client-bundles.ts";
import { injectReload } from "./create-kumiko-server-reload.ts";

// The dev server speaks plain http, so its minted cookies are never Secure and keep the unprefixed names.
const CSRF_COOKIE = sessionCookieName(CSRF_COOKIE_BASE, { secure: false });
const AUTH_COOKIE = sessionCookieName(AUTH_COOKIE_BASE, { secure: false });

// Minimal HTML when the caller didn't hand one in. `#root` is the
// default mount target for `createKumikoApp`, so the one-line client
// can attach without the sample having to ship its own template.
//
// `type="module"` is load-bearing: a classic script turns the bundle's
// top-level declarations into window properties, so a dependency exporting
// `function history()` (prosemirror-history, pulled in by tiptap) silently
// replaces `window.history` and every pushState afterwards throws. Prod
// (build-prod-bundle) has always emitted the module form.
//
// `interactive-widget=resizes-content`: without it, a mobile
// keyboard shrinks only the visual viewport, not the layout viewport that
// `position: fixed` anchors to — a fixed bottom action bar would stay
// pinned behind the keyboard instead of above it. iOS Safari ignores the
// key; renderer/web's useKeyboardInset covers it via window.visualViewport.
export const DEFAULT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content" />
    <title>Kumiko</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

// Injects <link rel="stylesheet" href="/styles.css"> into <head> if it
// is not already present. Called only when the stylesheet option is used;
// otherwise no CSS route is provided.
function injectStylesheet(html: string): string {
  if (html.includes('href="/styles.css"')) return html;
  const link = '<link rel="stylesheet" href="/styles.css" />';
  return html.includes("</head>")
    ? html.replace("</head>", `  ${link}\n</head>`)
    : `${link}${html}`;
}

export type DevHtmlTemplates = {
  readonly defaultTemplate: string;
  readonly byEntry: ReadonlyMap<string, string>;
};

// Single-entry uses one template (`htmlPath` or DEFAULT_HTML). Multi-entry
// uses one per entry (`entry.htmlPath ?? options.htmlPath ?? DEFAULT_HTML`);
// hostDispatch selects it per request.
export async function loadHtmlTemplates(
  entries: readonly NormalizedEntry[],
  htmlPath: string | undefined,
): Promise<DevHtmlTemplates> {
  const defaultTemplate =
    htmlPath !== undefined ? await readFile(resolve(htmlPath), "utf-8") : DEFAULT_HTML;
  const byEntry = new Map<string, string>();
  for (const e of entries) {
    byEntry.set(
      e.name,
      e.htmlPath !== undefined ? await readFile(resolve(e.htmlPath), "utf-8") : defaultTemplate,
    );
  }
  return { defaultTemplate, byEntry };
}

export type DevSystemQueryBuilder = (req: Request, socketAddress?: string) => PageHeadSystemQuery;

// Anonymous-role systemQuery, shared by resolvePageHead and hostDispatch —
// mirrors runProdApp's HostDispatchFn deps so dev/prod stay symmetric.
// Own resolver with the same effective hops as setupTestStack's internal
// buildServer: this path runs ahead of requestIdMiddleware's /api/* mount,
// so it can't reuse that instance. Two independent warn-once flags in dev
// is an accepted, low-risk gap (dev normally runs unproxied).
export function createDevSystemQueryBuilder(
  dispatcher: TestStack["dispatcher"],
  trustedProxyHops: number | undefined,
): DevSystemQueryBuilder {
  const pageHeadClientIpResolver = createClientIpResolver(
    trustedProxyHops ?? 0,
    "createKumikoServer(pageHead)",
  );
  return (req, socketAddress) =>
    buildRequestBoundSystemQuery({
      req,
      dispatcher,
      resolver: pageHeadClientIpResolver,
      socketAddress,
    });
}

export type DevHtmlDeps = {
  readonly templates: DevHtmlTemplates;
  readonly jwt: TestStack["jwt"];
  // Without an auth config the shell carries a JWT + CSRF cookie for the dev
  // user, so deep links (and the client's GET /api/schema) work without
  // login. With one, the client logs in through /auth/login instead.
  readonly autoMintJwt: boolean;
  readonly stylesheetPath: string | undefined;
  readonly resolvePageHead: PageHeadResolver | undefined;
  readonly buildSystemQuery: DevSystemQueryBuilder;
};

// Dev user = TestUsers.admin: demo features are openToAll, but the auth
// middleware still requires a valid JWT.
async function appendDevSessionCookies(headers: Headers, jwt: TestStack["jwt"]): Promise<void> {
  const token = await jwt.sign(TestUsers.admin);
  const csrf = generateToken();
  headers.append("Set-Cookie", `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
  headers.append("Set-Cookie", `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax`);
}

// resolvePageHead goes through the same headless resolveAndInjectPageHead
// that runProdApp uses, so dev and e2e exercise the one timeout and
// fallback path instead of a second copy of it.
async function injectDevPageHead(
  html: string,
  resolvePageHead: PageHeadResolver,
  req: Request,
  socketAddress: string | undefined,
  buildSystemQuery: DevSystemQueryBuilder,
): Promise<string> {
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? url.host;
  return resolveAndInjectPageHead(html, resolvePageHead, {
    path: url.pathname,
    host,
    preferredLocales: rankPreferredLocales({
      queryLang: url.searchParams.get("lang"),
      acceptLanguage: req.headers.get("accept-language"),
    }),
    systemQuery: buildSystemQuery(req, socketAddress),
    requestSignal: req.signal,
  });
}

export async function respondWithHtmlShell(
  deps: DevHtmlDeps,
  entryName: string,
  req: Request,
  socketAddress?: string,
  status = 200,
): Promise<Response> {
  const template = deps.templates.byEntry.get(entryName) ?? deps.templates.defaultTemplate;
  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  if (deps.autoMintJwt) await appendDevSessionCookies(headers, deps.jwt);
  let html = injectReload(template);
  if (deps.stylesheetPath !== undefined) html = injectStylesheet(html);
  if (deps.resolvePageHead !== undefined) {
    html = await injectDevPageHead(
      html,
      deps.resolvePageHead,
      req,
      socketAddress,
      deps.buildSystemQuery,
    );
  }
  return new Response(html, { status, headers });
}

// Raw file serve, no bundle injection — mirrors prod's `{ kind: "html", file }`.
export async function respondWithStaticHtmlFile(file: string, status: number): Promise<Response> {
  let content: string;
  try {
    content = await readFile(file, "utf-8");
  } catch (error) {
    if (errorCodeOf(error) !== "ENOENT") throw error;
    return new Response(`hostDispatch: file not found: ${file}`, { status: 500 });
  }
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
