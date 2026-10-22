import { describe, expect, test } from "bun:test";
import {
  buildDemoModePayload,
  DEMO_READ_ONLY_ERROR_CODE,
  withDemoReadOnlyFetch,
} from "../demo-mode.ts";

const ENV = {
  DEMO_ADMIN_EMAIL: "host@demo.example",
  DEMO_ADMIN_PASSWORD: "host-password-1234",
  DEMO_SYSADMIN_EMAIL: "sys@demo.example",
  DEMO_SYSADMIN_PASSWORD: "sys-password-12345",
};

function recordingHandler(): {
  readonly seen: (string | undefined)[];
  handler(req: Request, socketAddress?: string): Promise<Response>;
} {
  const seen: (string | undefined)[] = [];
  return {
    seen,
    handler: async (_req, socketAddress) => {
      seen.push(socketAddress);
      return new Response("passed");
    },
  };
}

describe("withDemoReadOnlyFetch", () => {
  test("read-only blocks a write with 403 demo_read_only", async () => {
    const inner = recordingHandler();
    const fetch = withDemoReadOnlyFetch(inner.handler, { readOnly: true });

    const res = await fetch(
      new Request("http://demo.test/api/write", { method: "POST" }),
      "1.2.3.4",
    );

    expect(res.status).toBe(403);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ isSuccess: false, error: { code: DEMO_READ_ONLY_ERROR_CODE } });
    expect(inner.seen).toEqual([]);
  });

  test("queries, login and GETs pass, with the socket address forwarded", async () => {
    const inner = recordingHandler();
    const fetch = withDemoReadOnlyFetch(inner.handler, { readOnly: true });

    await fetch(new Request("http://demo.test/api/query", { method: "POST" }), "1.2.3.4");
    await fetch(new Request("http://demo.test/api/auth/login", { method: "POST" }), "5.6.7.8");
    await fetch(new Request("http://demo.test/anything"), "9.9.9.9");

    expect(inner.seen).toEqual(["1.2.3.4", "5.6.7.8", "9.9.9.9"]);
  });

  test.each([
    ["POST", "/upload"],
    ["PUT", "/files/abc"],
    ["DELETE", "/api/anything"],
    ["POST", "/unsubscribe"],
    ["POST", "/api/query/"],
    ["POST", "/api/auth/login/"],
  ])("%s %s is blocked, only the exact allowlist paths pass", async (method, path) => {
    const inner = recordingHandler();
    const fetch = withDemoReadOnlyFetch(inner.handler, { readOnly: true });

    const res = await fetch(new Request(`http://demo.test${path}`, { method }));

    expect(res.status).toBe(403);
    expect(inner.seen).toEqual([]);
  });

  test("allowedWritePaths opens an extra path", async () => {
    const inner = recordingHandler();
    const fetch = withDemoReadOnlyFetch(inner.handler, {
      readOnly: true,
      allowedWritePaths: ["/api/auth/signup"],
    });

    const res = await fetch(new Request("http://demo.test/api/auth/signup", { method: "POST" }));

    expect(res.status).toBe(200);
  });

  test("a WebSocket upgrade is blocked, because the socket writes after the upgrade", async () => {
    const inner = recordingHandler();
    const fetch = withDemoReadOnlyFetch(inner.handler, { readOnly: true });

    const res = await fetch(
      new Request("http://demo.test/api/ws/live", { headers: { upgrade: "websocket" } }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "demo_read_only" } });
    expect(inner.seen).toEqual([]);
  });

  test("a WebSocket route listed in allowedWritePaths may upgrade", async () => {
    const inner = recordingHandler();
    const fetch = withDemoReadOnlyFetch(inner.handler, {
      readOnly: true,
      allowedWritePaths: ["/api/ws/live"],
    });

    const res = await fetch(
      new Request("http://demo.test/api/ws/live", { headers: { upgrade: "websocket" } }),
    );

    expect(res.status).toBe(200);
  });

  test("readOnly false keeps the handler untouched", () => {
    const inner = recordingHandler();
    expect(withDemoReadOnlyFetch(inner.handler, { readOnly: false })).toBe(inner.handler);
  });
});

describe("buildDemoModePayload", () => {
  test("publishes no account unless the notice lists it", () => {
    expect(buildDemoModePayload({ readOnly: true }, ENV).notice.accounts).toEqual([]);
  });

  test("publishes only the listed accounts, and only while read-only", () => {
    const listed = { notice: { accounts: ["admin" as const] } };
    expect(buildDemoModePayload({ readOnly: true, ...listed }, ENV).notice.accounts).toEqual([
      { role: "admin", email: ENV.DEMO_ADMIN_EMAIL, password: ENV.DEMO_ADMIN_PASSWORD },
    ]);
    expect(buildDemoModePayload({ readOnly: false, ...listed }, ENV).notice.accounts).toEqual([]);
  });

  test("carries the label of an account entry into the payload", () => {
    const label = { de: "Verwalter", en: "Property manager" };
    const payload = buildDemoModePayload(
      { readOnly: true, notice: { accounts: [{ role: "admin", label }, "sysadmin"] } },
      ENV,
    );
    expect(payload.notice.accounts).toEqual([
      { role: "admin", label, email: ENV.DEMO_ADMIN_EMAIL, password: ENV.DEMO_ADMIN_PASSWORD },
      { role: "sysadmin", email: ENV.DEMO_SYSADMIN_EMAIL, password: ENV.DEMO_SYSADMIN_PASSWORD },
    ]);
  });

  test("passes text and links through", () => {
    const payload = buildDemoModePayload(
      {
        readOnly: true,
        notice: {
          text: { en: "Read-only demo" },
          links: [{ label: { en: "Docs" }, href: "https://docs.example" }],
        },
      },
      {},
    );
    expect(payload).toEqual({
      readOnly: true,
      notice: {
        text: { en: "Read-only demo" },
        links: [{ label: { en: "Docs" }, href: "https://docs.example" }],
        accounts: [],
      },
    });
  });
});
