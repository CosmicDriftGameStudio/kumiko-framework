import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPinnedRequest, egress, withManualRedirect, withOriginalUrl } from "../egress";

let server: ReturnType<typeof Bun.serve>;
let port: number;
const requestCounts = new Map<string, number>();

function countedResponse(path: string, respond: () => Response): Response {
  requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
  return respond();
}

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/ok") {
        return countedResponse("/ok", () => new Response("hello", { status: 200 }));
      }
      if (url.pathname === "/final") {
        return countedResponse("/final", () => new Response("final", { status: 200 }));
      }
      if (url.pathname === "/allowed-redirect") {
        return countedResponse(
          "/allowed-redirect",
          () =>
            new Response(null, {
              status: 302,
              headers: { location: `http://127.0.0.1:${port}/final` },
            }),
        );
      }
      if (url.pathname === "/blocked-redirect") {
        // Same physical server, different hostname string ("localhost" is
        // not in the allowlist used below even though it resolves here too).
        return countedResponse(
          "/blocked-redirect",
          () =>
            new Response(null, {
              status: 302,
              headers: { location: `http://localhost:${port}/final` },
            }),
        );
      }
      if (url.pathname === "/cross-host-redirect") {
        // Redirects to a *different* allowlisted host (not just a
        // disallowed one) — this must still be rejected even though both
        // hosts individually pass assertAllowedHost, because init.headers
        // are replayed on every hop and must not leak across hosts.
        return countedResponse(
          "/cross-host-redirect",
          () =>
            new Response(null, {
              status: 302,
              headers: { location: `http://localhost:${port}/final` },
            }),
        );
      }
      if (url.pathname === "/redirect-loop") {
        return countedResponse(
          "/redirect-loop",
          () =>
            new Response(null, {
              status: 302,
              headers: { location: `http://127.0.0.1:${port}/redirect-loop` },
            }),
        );
      }
      return countedResponse(url.pathname, () => new Response("not found", { status: 404 }));
    },
  });
  if (typeof server.port !== "number") {
    throw new Error("test server did not report a bound port");
  }
  port = server.port;
});

afterAll(() => {
  server.stop(true);
});

describe("egress internal", () => {
  test("fetches an allowlisted host directly", async () => {
    const fetchIt = egress({ kind: "internal", allowHosts: ["127.0.0.1"] });
    const res = await fetchIt(`http://127.0.0.1:${port}/ok`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  test("rejects a host not in the allowlist without making any request", async () => {
    const before = requestCounts.get("/ok") ?? 0;
    const fetchIt = egress({ kind: "internal", allowHosts: ["127.0.0.1"] });
    await expect(fetchIt(`http://localhost:${port}/ok`)).rejects.toThrow();
    expect(requestCounts.get("/ok") ?? 0).toBe(before); // never dialed
  });

  test("follows a redirect to a host that stays inside the allowlist", async () => {
    const fetchIt = egress({ kind: "internal", allowHosts: ["127.0.0.1"] });
    const res = await fetchIt(`http://127.0.0.1:${port}/allowed-redirect`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("final");
    expect(requestCounts.get("/allowed-redirect")).toBeGreaterThan(0);
    expect(requestCounts.get("/final")).toBeGreaterThan(0);
  });

  test("rejects a redirect whose target host falls outside the allowlist, without following it", async () => {
    const before = requestCounts.get("/final") ?? 0;
    const fetchIt = egress({ kind: "internal", allowHosts: ["127.0.0.1"] });
    await expect(fetchIt(`http://127.0.0.1:${port}/blocked-redirect`)).rejects.toThrow();
    expect(requestCounts.get("/final") ?? 0).toBe(before); // redirect target never dialed
  });

  test("does not silently follow a disallowed redirect even if the caller passes redirect: 'follow'", async () => {
    const fetchIt = egress({ kind: "internal", allowHosts: ["127.0.0.1"] });
    await expect(
      fetchIt(`http://127.0.0.1:${port}/blocked-redirect`, { redirect: "follow" }),
    ).rejects.toThrow();
  });

  test("rejects a redirect to a different host even when both hosts are allowlisted", async () => {
    const before = requestCounts.get("/final") ?? 0;
    const fetchIt = egress({ kind: "internal", allowHosts: ["127.0.0.1", "localhost"] });
    await expect(fetchIt(`http://127.0.0.1:${port}/cross-host-redirect`)).rejects.toThrow(
      /crosses host/,
    );
    expect(requestCounts.get("/final") ?? 0).toBe(before); // never dialed the second host
  });

  test("throws once the redirect hop cap is exceeded", async () => {
    const fetchIt = egress({ kind: "internal", allowHosts: ["127.0.0.1"] });
    await expect(fetchIt(`http://127.0.0.1:${port}/redirect-loop`)).rejects.toThrow(/redirects/);
  });
});

describe("egress external / tenant-supplied", () => {
  test.each(["external", "tenant-supplied"] as const)(
    "%s denies a loopback target without connecting to it",
    async (kind) => {
      const before = requestCounts.get("/ok") ?? 0;
      const fetchIt = egress(
        kind === "external" ? { kind: "external" } : { kind: "tenant-supplied" },
      );
      await expect(fetchIt(`http://127.0.0.1:${port}/ok`)).rejects.toThrow();
      expect(requestCounts.get("/ok") ?? 0).toBe(before); // guard fired before any connection
    },
  );

  test.each(["external", "tenant-supplied"] as const)(
    "%s rejects a non-http(s) scheme",
    async (kind) => {
      const fetchIt = egress(
        kind === "external" ? { kind: "external" } : { kind: "tenant-supplied" },
      );
      await expect(fetchIt("file:///etc/passwd")).rejects.toThrow();
    },
  );

  // `external`/`tenant-supplied` never auto-follow a redirect (see
  // withManualRedirect above) — the caller sees the 3xx itself and is
  // expected to call egress() again with the Location header to follow it.
  // That means every hop is a fresh egress() call, and this pins that the
  // DNS-rebinding-safe host check applies to a redirect target exactly the
  // way it applies to any other URL — not a special case that could be
  // missed.
  test.each(["external", "tenant-supplied"] as const)(
    "%s: following a redirect Location by calling egress() again re-validates the new host",
    async (kind) => {
      const fetchIt = egress(
        kind === "external" ? { kind: "external" } : { kind: "tenant-supplied" },
      );
      const redirectLocation = "http://169.254.169.254/latest/meta-data/"; // simulated hop target
      await expect(fetchIt(redirectLocation)).rejects.toThrow();
    },
  );
});

describe("withOriginalUrl", () => {
  test("overwrites Response.url to the original request URL, not the pinned IP", async () => {
    const echoServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("ok"),
    });
    try {
      const originalUrl = new URL("http://vhost.example/some/path");
      const pinned = buildPinnedRequest(
        originalUrl,
        { address: "127.0.0.1", family: 4 },
        undefined,
      );
      pinned.url.port = String(echoServer.port);

      const res = await fetch(pinned.url, pinned.init);
      expect(res.url).not.toBe(originalUrl.toString()); // sanity: fetch itself reports the pinned IP

      expect(withOriginalUrl(res, originalUrl).url).toBe(originalUrl.toString());
    } finally {
      echoServer.stop(true);
    }
  });

  // This is the exact caller pattern runEgress's own comment promises:
  // "call egress() again with the Location header". A relative Location
  // resolved against the pinned-IP res.url would land on the IP, and the
  // resulting egress() call would then pin/SNI-validate against that IP
  // instead of a real hostname — this pins that it resolves against the
  // original host instead.
  test("a relative redirect Location resolves against the original host, not the pinned IP", async () => {
    const redirectServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(null, { status: 302, headers: { location: "/next" } }),
    });
    try {
      const originalUrl = new URL("http://vhost.example/start");
      const pinned = buildPinnedRequest(
        originalUrl,
        { address: "127.0.0.1", family: 4 },
        undefined,
      );
      pinned.url.port = String(redirectServer.port);

      const res = withOriginalUrl(
        await fetch(pinned.url, withManualRedirect(pinned.init)),
        originalUrl,
      );
      const location = res.headers.get("location");
      if (!location) throw new Error("test server did not send a Location header");
      const next = new URL(location, res.url);

      expect(next.hostname).toBe("vhost.example"); // not the pinned 127.0.0.1
      expect(next.pathname).toBe("/next");
    } finally {
      redirectServer.stop(true);
    }
  });
});

describe("buildPinnedRequest", () => {
  test("sends fetch an IP-literal URL, never the original hostname", () => {
    const url = new URL("https://attacker-controlled.example/path?x=1");
    const pinned = buildPinnedRequest(url, { address: "203.0.113.5", family: 4 }, undefined);

    expect(pinned.url.hostname).toBe("203.0.113.5");
    expect(pinned.url.pathname).toBe("/path");
    expect(pinned.url.search).toBe("?x=1");
    // Nothing hostname-shaped survives into the request fetch() receives —
    // there is no hostname left for fetch to resolve a second time.
    expect(pinned.url.href).not.toContain("attacker-controlled.example");
  });

  test("preserves the original hostname in the Host header", () => {
    const url = new URL("https://attacker-controlled.example/");
    const pinned = buildPinnedRequest(url, { address: "203.0.113.5", family: 4 }, undefined);

    expect(new Headers(pinned.init.headers).get("host")).toBe("attacker-controlled.example");
  });

  test("preserves the original hostname in tls.servername for https", () => {
    const url = new URL("https://attacker-controlled.example/");
    const pinned = buildPinnedRequest(url, { address: "203.0.113.5", family: 4 }, undefined);

    expect(pinned.init.tls).toEqual({ servername: "attacker-controlled.example" });
  });

  test("omits tls for http (nothing to pin SNI for)", () => {
    const url = new URL("http://attacker-controlled.example/");
    const pinned = buildPinnedRequest(url, { address: "203.0.113.5", family: 4 }, undefined);

    expect(pinned.init.tls).toBeUndefined();
  });

  test("pins an IPv6 address using bracket notation", () => {
    const url = new URL("https://example.com/");
    const pinned = buildPinnedRequest(
      url,
      { address: "2606:4700:10::6814:179a", family: 6 },
      undefined,
    );

    expect(pinned.url.hostname).toBe("[2606:4700:10::6814:179a]");
  });

  test("overrides a caller-supplied Host header rather than merging it", () => {
    const url = new URL("https://real-host.example/");
    const pinned = buildPinnedRequest(
      url,
      { address: "203.0.113.5", family: 4 },
      { headers: { Host: "spoofed.example" } },
    );

    expect(new Headers(pinned.init.headers).get("host")).toBe("real-host.example");
  });

  test("preserves a non-default port in both the pinned URL and the Host header", () => {
    const url = new URL("https://attacker-controlled.example:9443/");
    const pinned = buildPinnedRequest(url, { address: "203.0.113.5", family: 4 }, undefined);

    expect(pinned.url.port).toBe("9443");
    expect(new Headers(pinned.init.headers).get("host")).toBe("attacker-controlled.example:9443");
  });
});

describe("egress external / tenant-supplied: connects to the pinned address for real", () => {
  test("the Host header set by buildPinnedRequest reaches the origin unmodified", async () => {
    const echo = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => new Response(req.headers.get("host") ?? "MISSING"),
    });
    try {
      const url = new URL(`http://vhost.example/`);
      const pinned = buildPinnedRequest(url, { address: "127.0.0.1", family: 4 }, undefined);
      pinned.url.port = String(echo.port);
      const res = await fetch(pinned.url, pinned.init);
      expect(await res.text()).toBe("vhost.example");
    } finally {
      echo.stop(true);
    }
  });
});

describe("egress external / tenant-supplied: TLS/SNI stay intact when connecting by pinned IP", () => {
  const CERT_HOSTNAME = "kumiko-egress-test.local";

  let tlsServer: ReturnType<typeof Bun.serve>;
  let cert: Buffer;
  let certDir: string;

  beforeAll(() => {
    // Generated fresh per test run rather than checked in as a fixture —
    // a committed .pem/.key pair (even a self-signed, test-only one) is
    // what secret scanners and this repo's push protection are watching
    // for, and there is no precedent for one in this repo's history.
    certDir = mkdtempSync(join(tmpdir(), "kumiko-egress-tls-test-"));
    const certPath = join(certDir, "cert.pem");
    const keyPath = join(certDir, "key.pem");
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      `/CN=${CERT_HOSTNAME}`,
      "-addext",
      `subjectAltName=DNS:${CERT_HOSTNAME}`,
    ]);
    cert = readFileSync(certPath);
    const key = readFileSync(keyPath);

    tlsServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert, key },
      fetch: () => new Response("ok"),
    });
  });

  afterAll(() => {
    tlsServer.stop(true);
    rmSync(certDir, { recursive: true, force: true });
  });

  // buildPinnedRequest always sets tls.servername itself (it must not be
  // overridable by the caller, same as the redirect mode below) — so `ca`
  // is added to its result afterwards, purely to make this self-signed
  // fixture trusted for the test. Production call sites never set `ca`;
  // they rely on the system trust store, which the real-endpoint
  // integration test below exercises.
  function trustFixtureCa(init: RequestInit & { tls?: { servername: string } }): RequestInit {
    return { ...init, tls: { ...init.tls, ca: cert } } as RequestInit;
  }

  test("validates the certificate against the pinned servername and succeeds when it matches", async () => {
    const url = new URL(`https://${CERT_HOSTNAME}/`);
    const pinned = buildPinnedRequest(url, { address: "127.0.0.1", family: 4 }, undefined);
    pinned.url.port = String(tlsServer.port);

    const res = await fetch(pinned.url, trustFixtureCa(pinned.init));
    expect(res.status).toBe(200);
  });

  test("fails closed when the pinned servername does not match the certificate", async () => {
    const url = new URL("https://attacker-does-not-own-this-cert.example/");
    const pinned = buildPinnedRequest(url, { address: "127.0.0.1", family: 4 }, undefined);
    pinned.url.port = String(tlsServer.port);

    // A bare `.rejects.toThrow()` would also pass if the server were simply
    // unreachable, proving nothing about the SNI/cert check itself — match
    // the actual TLS hostname-mismatch error so the test fails if the
    // rejection reason ever silently changes to something unrelated.
    await expect(fetch(pinned.url, trustFixtureCa(pinned.init))).rejects.toThrow(
      /ALTNAME|certificate/i,
    );
  });
});

describe("withManualRedirect", () => {
  test("always forces redirect: 'manual', even if the caller's init requests 'follow'", () => {
    expect(withManualRedirect({ redirect: "follow", headers: { "x-test": "1" } })).toEqual({
      redirect: "manual",
      headers: { "x-test": "1" },
    });
  });

  test("sets redirect: 'manual' when no init is given", () => {
    expect(withManualRedirect(undefined)).toEqual({ redirect: "manual" });
  });

  // The actual runEgress call path is
  // withManualRedirect(buildPinnedRequest(...).init) — withManualRedirect's
  // own type signature is plain RequestInit, which type-erases `tls`.
  // Pinning this hermetically (not just via the network-guarded TLS
  // integration tests above) protects against a future refactor that
  // builds the returned object explicitly, field by field, instead of
  // spreading `init` — which would silently drop `tls` and disable SNI
  // pinning without any test failing.
  test("preserves tls.servername from buildPinnedRequest through the spread", () => {
    const url = new URL("https://attacker-controlled.example/");
    const pinned = buildPinnedRequest(url, { address: "203.0.113.5", family: 4 }, undefined);

    expect(withManualRedirect(pinned.init)).toMatchObject({
      redirect: "manual",
      tls: { servername: "attacker-controlled.example" },
    });
  });
});
