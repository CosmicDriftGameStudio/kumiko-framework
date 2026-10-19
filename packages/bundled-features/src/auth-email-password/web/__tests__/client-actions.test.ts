import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { emailPasswordClient } from "../client-plugin.ts";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

function stubFetch(response: Response): void {
  fetchMock = mock(async () => response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

beforeEach(() => stubFetch(new Response(null, { status: 200 })));
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { clientActions } = emailPasswordClient();

function handler(name: string) {
  const found = clientActions[name];
  if (found === undefined) throw new Error(`client action ${name} is not registered`);
  return found;
}

describe.each([
  ["auth-email-password:request-password-reset", "/api/auth/request-password-reset"],
  ["auth-email-password:request-email-verification", "/api/auth/request-email-verification"],
])("%s", (name, endpoint) => {
  test("posts the payload email and reports success", async () => {
    const outcome = await handler(name)({ email: "ada@example.com" });

    expect(outcome).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(endpoint);
    expect(init.body).toBe(JSON.stringify({ email: "ada@example.com" }));
  });

  test.each([[{}], [{ email: 42 }], [{ email: "" }]])(
    "rejects the payload %p without calling the server",
    async (payload) => {
      const outcome = await handler(name)(payload);

      expect(outcome).toEqual({ ok: false, message: "auth.errors.invalidBody" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("maps a rate-limit response to the rate-limit message", async () => {
    stubFetch(new Response(JSON.stringify({ error: {} }), { status: 429 }));

    expect(await handler(name)({ email: "ada@example.com" })).toEqual({
      ok: false,
      message: "auth.errors.tooManyRequests",
    });
  });

  test("maps any other server failure to the generic message", async () => {
    stubFetch(new Response(JSON.stringify({ error: { code: "internal" } }), { status: 500 }));

    expect(await handler(name)({ email: "ada@example.com" })).toEqual({
      ok: false,
      message: "auth.errors.unknownError",
    });
  });
});
