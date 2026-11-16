import { UNKNOWN_CLIENT_IP } from "@cosmicdrift/kumiko-framework/api";
import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

export function registerExportDownloadRoutes(r: FeatureRegistrar<"user-data-rights">): void {
  // Magic-link path (anonymous): the email link carries the token as a
  // URL fragment (`#token=<plain>`) instead of a query param — fragments
  // never leave the browser, so they never hit proxy/access logs
  // This route only serves the interstitial page; the
  // external script reads the fragment client-side and exchanges the
  // token via POST for the signed URL.
  //
  // No `?token=` query fallback: framework is zero-legacy — no
  // live customer data / no emails in flight that would need
  // bridging, so there's nothing a fallback would need to cover. A query
  // param reaches the server as part of the request URL and gets written
  // to proxy/access logs regardless of what the handler does with it
  // afterward (a redirect doesn't undo an already-logged request) — the
  // only leak-proof fix is to never accept the token that way.
  //
  // Path sits outside /api/* — r.httpRoute must not claim the /api namespace
  // (reserved for write/query/batch/auth/sse-dispatcher).
  //
  // The session path (logged-in download) needs no httpRoute wrapper: the
  // client calls download-by-job via the Dispatcher (with X-CSRF-Token) and
  // navigates to the returned signed URL — see postWithDownload in
  // privacy-center-screen.
  r.httpRoute({
    method: "GET",
    path: "/user-export/by-token",
    anonymous: true,
    // Entry point of the emailed download link; cheap static page, but
    // anonymous and token-bearing, so bound per-IP probing.
    rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
    // guard:dup-ok the few-shot corpus extractor reads httpRoute handlers only when they are inline
    handler: async (c) => {
      return c.body(TOKEN_EXCHANGE_PAGE_HTML, 200, {
        "content-type": "text/html; charset=utf-8",
      });
    },
  });

  // External script for the interstitial page above — same-origin file
  // instead of inline <script>, so the page also works under a strict
  // `script-src 'self'` CSP (apps set CSP via the security-headers
  // option, without assuming `unsafe-inline`).
  r.httpRoute({
    method: "GET",
    path: "/user-export/by-token.js",
    anonymous: true,
    // guard:dup-ok the few-shot corpus extractor reads httpRoute handlers only when they are inline
    handler: async (c) => {
      return c.body(TOKEN_EXCHANGE_PAGE_JS, 200, {
        "content-type": "application/javascript; charset=utf-8",
      });
    },
  });

  // Exchange endpoint for the interstitial page: the token arrives here
  // as a POST body instead of a query string. A dedicated
  // route rather than letting the browser JS call /api/query directly,
  // for two reasons:
  //   1. IP/UA audit — extractAuditMeta needs the raw request headers and
  //      the framework-resolved client IP, which only the server has, not
  //      the browser (see the GET path above). Without this route every
  //      fragment-path download would land in download-attempt with
  //      lastUsedFromIp/UA = null.
  //   2. /api/query is the reserved dispatcher namespace for
  //      authenticated writes/queries — an anonymous cross-origin POST
  //      there isn't guaranteed to be reachable (origin guard).
  r.httpRoute({
    method: "POST",
    path: "/user-export/by-token",
    anonymous: true,
    handler: async (c, { app, clientIp }) => {
      const url = new URL(c.req.url);
      const parsedBody = await c.req.json().catch(() => null);
      const token = isPlainObject(parsedBody) ? parsedBody["token"] : undefined;
      if (typeof token !== "string" || token.length === 0) {
        return c.json({ error: "missing_token" }, 400);
      }
      const auditMeta = extractAuditMeta(c.req.raw.headers, clientIp);
      return app.fetch(
        new Request(`${url.origin}/api/query`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "user-data-rights:query:download-by-token",
            payload: { token, auditMeta },
          }),
        }),
        // download-by-token.query.ts's `rateLimit: { per: "ip", limit: 30 }`
        // resolves the client IP from this internal request's env (2nd
        // app.fetch arg), same as Bun.serve's socket address — without it,
        // the resolver has neither a trusted XFF entry (trustedProxyHops
        // defaults to 0, ignoring headers entirely) nor a socket, so every
        // fragment-POST download would fall to the shared "unknown" bucket,
        // turning the per-user 30/min backstop into one global bucket an
        // attacker can exhaust for everyone. Passing `clientIp`
        // directly as env — the same server-resolved, trustedProxyHops-
        // aware value the outer request already trusted — reaches
        // extractSocketAddress() without going through header/hop-count
        // logic at all.
        clientIp,
      );
    },
  });
}

// `clientIp` comes from the server's trustedProxyHops-aware resolver instead
// of reading X-Forwarded-For here, where a forged first entry would spoof the
// audit IP. A caller hitting /api/query directly (bypassing this httpRoute
// wrapper) with its own auditMeta can still lie — accepted, see
// download-by-token.query.ts.
export function extractAuditMeta(
  headers: Headers,
  clientIp: string,
): { ip: string | null; userAgent: string | null } {
  return {
    ip: clientIp === UNKNOWN_CLIENT_IP ? null : clientIp,
    userAgent: headers.get("user-agent"),
  };
}

// Interstitial page for the magic-link fragment exchange (see the
// httpRoute above). Plain static markup — no build step, no i18n lookup
// (the server doesn't know a user locale here; anonymous path).
const TOKEN_EXCHANGE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Export Download</title></head>
<body>
<p id="status">Preparing your download…</p>
<script src="/user-export/by-token.js"></script>
</body>
</html>`;

// Reads the token client-side from the URL fragment (never sent to the
// server) and exchanges it via POST for the signed URL. Same-origin
// external file instead of inline <script>, so the page also works under
// a strict `script-src 'self'` CSP.
const TOKEN_EXCHANGE_PAGE_JS = `(async () => {
  const status = document.getElementById("status");
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("token");
  if (!token) {
    status.textContent = "Invalid download link.";
    return;
  }
  try {
    const res = await fetch("/user-export/by-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await res.json();
    if (!res.ok || !body || !body.data || !body.data.url) {
      status.textContent = "This download link is invalid or has expired.";
      return;
    }
    location.href = body.data.url;
  } catch {
    status.textContent = "Could not start the download.";
  }
})();`;
