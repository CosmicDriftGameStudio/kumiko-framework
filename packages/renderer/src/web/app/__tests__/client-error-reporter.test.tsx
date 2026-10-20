import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClientErrorReporter, MAX_CLIENT_ERROR_REPORTS } from "../client-error-reporter.ts";

type Recorded = { readonly url: string; readonly init: RequestInit };

let calls: Recorded[];
let originalFetch: typeof fetch;

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  window.history.replaceState(null, "", "/rent/edit?secret=1#frag");
  clearCsrfCookie();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCsrfCookie();
});

// The DOM run shares one document across files: a csrf cookie another file set without a path
// landed on "/" or on the directory of the URL it left behind, so both get cleared.
function clearCsrfCookie(): void {
  for (const path of ["/", "/rent"]) {
    document.cookie = `kumiko_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
  }
}

const lastBody = (): Record<string, unknown> =>
  JSON.parse(String(calls[calls.length - 1]?.init.body));

describe("createClientErrorReporter", () => {
  test("posts the strict payload without query or hash", () => {
    createClientErrorReporter().report({
      kind: "render",
      error: new Error("kaputt"),
      errorId: "11111111-1111-4111-8111-111111111111",
      screen: "app:screen:rent",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/client-errors");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
    });
    expect(lastBody()).toMatchObject({
      errorId: "11111111-1111-4111-8111-111111111111",
      kind: "render",
      message: "kaputt",
      screen: "app:screen:rent",
      path: "/rent/edit",
    });
    expect(Object.keys(lastBody()).sort()).toEqual(
      ["errorId", "kind", "message", "path", "screen", "stack"].sort(),
    );
  });

  test("sends the CSRF header only when the cookie is present", () => {
    const reporter = createClientErrorReporter();
    reporter.report({ kind: "render", error: new Error("no-cookie") });
    expect(new Headers(calls[0]?.init.headers).get("x-csrf-token")).toBeNull();

    document.cookie = "kumiko_csrf=tok-123; path=/";
    reporter.report({ kind: "render", error: new Error("with-cookie") });
    expect(new Headers(calls[1]?.init.headers).get("x-csrf-token")).toBe("tok-123");
  });

  test("clips message, stack, screen and path to the server limits", () => {
    const error = new Error("m".repeat(900));
    error.stack = "s".repeat(9000);
    window.history.replaceState(null, "", `/${"p".repeat(500)}`);
    createClientErrorReporter().report({ kind: "render", error, screen: "x".repeat(400) });
    const body = lastBody();
    expect(String(body["message"])).toHaveLength(500);
    expect(String(body["stack"])).toHaveLength(4000);
    expect(String(body["screen"])).toHaveLength(200);
    expect(String(body["path"])).toHaveLength(300);
  });

  test("drops duplicates by message and stops after the per-page limit", () => {
    const reporter = createClientErrorReporter();
    reporter.report({ kind: "render", error: new Error("same") });
    reporter.report({ kind: "render", error: new Error("same") });
    expect(calls).toHaveLength(1);
    for (let i = 0; i < MAX_CLIENT_ERROR_REPORTS + 3; i++) {
      reporter.report({ kind: "render", error: new Error(`distinct-${i}`) });
    }
    expect(calls).toHaveLength(MAX_CLIENT_ERROR_REPORTS);
  });

  test("window error and unhandledrejection become kind unhandled until uninstalled", () => {
    const uninstall = createClientErrorReporter().installGlobalHandlers();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("sync-boom"), message: "x" }));
    expect(lastBody()).toMatchObject({ kind: "unhandled", message: "sync-boom" });

    const rejection = new Event("unhandledrejection");
    Object.assign(rejection, { reason: new Error("async-boom") });
    window.dispatchEvent(rejection);
    expect(lastBody()).toMatchObject({ kind: "unhandled", message: "async-boom" });

    uninstall();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("after"), message: "after" }));
    expect(calls).toHaveLength(2);
  });

  test("a failing fetch is swallowed without a retry loop", async () => {
    globalThis.fetch = (async (url: unknown, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      throw new Error("offline");
    }) as typeof fetch;
    createClientErrorReporter().report({ kind: "render", error: new Error("e") });
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });
});
