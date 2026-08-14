import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { egress, withManualRedirect } from "../egress";

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
});
