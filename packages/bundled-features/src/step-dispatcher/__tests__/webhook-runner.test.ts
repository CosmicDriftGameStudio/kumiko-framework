// Host-egress guard tests for performWebhookDispatch — spec.url is
// request-controlled (see webhook-runner.ts header), so it must resolve to
// a public address before any connect is attempted, mirroring the SMTP/
// IMAP host guard.

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { lookup } from "node:dns/promises";
import { createSecret, type SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import {
  performWebhookDispatch,
  setWebhookFetch,
  setWebhookHostLookup,
  WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
  type WebhookDispatchDeps,
} from "../webhook-runner.js";

function fakeLookupFor(addressesByHost: Readonly<Record<string, string>>): typeof lookup {
  return (async (hostname: string) => {
    const address = addressesByHost[hostname];
    if (!address) throw new Error(`ENOTFOUND ${hostname}`);
    return [{ address, family: 4 }];
  }) as unknown as typeof lookup;
}

const fetchMock = mock<typeof fetch>();

const TEST_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_USER_ID = "22222222-2222-4222-8222-222222222222";

const noSecretsDeps: WebhookDispatchDeps = {
  tenantId: TEST_TENANT_ID,
  userId: TEST_USER_ID,
  secrets: undefined,
};

function fakeSecrets(value: string | undefined) {
  const get = mock(async () => (value === undefined ? undefined : createSecret(value)));
  const secrets: SecretsContext = {
    get,
    has: async () => value !== undefined,
    set: async () => {},
    delete: async () => true,
  };
  return { secrets, get };
}

afterEach(() => {
  fetchMock.mockReset();
  setWebhookFetch(fetch);
  setWebhookHostLookup(undefined);
  delete process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
});

describe("performWebhookDispatch — host-egress guard", () => {
  test("a private IP-literal host is rejected before any connect attempt", async () => {
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    const result = await performWebhookDispatch(
      {
        url: "http://10.0.0.5/hook",
        method: "POST",
        headers: {},
      },
      noSecretsDeps,
    );
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a hostname resolving to a private address is rejected, without leaking the resolved address", async () => {
    setWebhookHostLookup(fakeLookupFor({ "internal.example": "127.0.0.1" }));
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    const result = await performWebhookDispatch(
      {
        url: "http://internal.example/hook",
        method: "POST",
        headers: {},
      },
      noSecretsDeps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("127.0.0.1");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a DNS resolution failure surfaces as a delivery error, not a thrown exception", async () => {
    setWebhookHostLookup(fakeLookupFor({}));
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    const result = await performWebhookDispatch(
      {
        url: "http://nowhere.example/hook",
        method: "POST",
        headers: {},
      },
      noSecretsDeps,
    );
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a blocked host and a DNS resolution failure produce the exact same tenant-visible error, without the host", async () => {
    setWebhookFetch(fetchMock as unknown as typeof fetch);

    const blocked = await performWebhookDispatch(
      {
        url: "http://10.0.0.5/hook",
        method: "POST",
        headers: {},
      },
      noSecretsDeps,
    );
    setWebhookHostLookup(fakeLookupFor({}));
    const unresolvable = await performWebhookDispatch(
      {
        url: "http://nowhere.example/hook",
        method: "POST",
        headers: {},
      },
      noSecretsDeps,
    );

    expect(blocked.ok).toBe(false);
    expect(unresolvable.ok).toBe(false);
    if (blocked.ok || unresolvable.ok) throw new Error("unreachable");
    expect(blocked.error).toBe(unresolvable.error);
    expect(blocked.error).not.toContain("10.0.0.5");
    expect(unresolvable.error).not.toContain("nowhere.example");
  });

  test("an operator-allowlisted private host bypasses resolution and keeps its raw url", async () => {
    process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "webhook-receiver.internal";
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await performWebhookDispatch(
      {
        url: "http://webhook-receiver.internal/hook",
        method: "POST",
        headers: {},
      },
      noSecretsDeps,
    );

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe("http://webhook-receiver.internal/hook");
  });

  test("a public hostname is pinned to its resolved address, keeping the original host as Host header and TLS SNI", async () => {
    setWebhookHostLookup(fakeLookupFor({ "hooks.example.com": "203.0.113.9" }));
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await performWebhookDispatch(
      {
        url: "https://hooks.example.com/incident",
        method: "POST",
        headers: {},
      },
      noSecretsDeps,
    );

    expect(result.ok).toBe(true);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe("https://203.0.113.9/incident");
    const headers = init?.headers as Headers;
    expect(headers.get("host")).toBe("hooks.example.com");
    expect((init as unknown as { tls?: { servername: string } })?.tls?.servername).toBe(
      "hooks.example.com",
    );
  });
});

describe("performWebhookDispatch — auth.secret resolution", () => {
  test("bearer auth sends the tenant's secret under the Authorization header", async () => {
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "hooks.example";
    const { secrets, get } = fakeSecrets("tok_live_abc123");

    const result = await performWebhookDispatch(
      {
        url: "http://hooks.example/hook",
        method: "POST",
        headers: {},
        auth: { kind: "bearer", secret: "incident-hook" },
      },
      { tenantId: TEST_TENANT_ID, userId: TEST_USER_ID, secrets },
    );

    expect(result.ok).toBe(true);
    expect(get).toHaveBeenCalledWith(TEST_TENANT_ID, "step-dispatcher:webhook-auth.incident-hook", {
      userId: TEST_USER_ID,
      handlerName: "step-dispatcher:webhook.send",
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok_live_abc123");
  });

  test("header auth sends the tenant's secret under the configured header name", async () => {
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "hooks.example";
    const { secrets } = fakeSecrets("shared-secret-xyz");

    const result = await performWebhookDispatch(
      {
        url: "http://hooks.example/hook",
        method: "POST",
        headers: {},
        auth: { kind: "header", name: "x-hub-signature", secret: "incident-hook" },
      },
      { tenantId: TEST_TENANT_ID, userId: TEST_USER_ID, secrets },
    );

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("x-hub-signature")).toBe("shared-secret-xyz");
  });

  test("a missing secret fails without leaking the secret name or fetching", async () => {
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "hooks.example";
    const { secrets } = fakeSecrets(undefined);

    const result = await performWebhookDispatch(
      {
        url: "http://hooks.example/hook",
        method: "POST",
        headers: {},
        auth: { kind: "bearer", secret: "incident-hook" },
      },
      { tenantId: TEST_TENANT_ID, userId: TEST_USER_ID, secrets },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("webhook auth secret is not available");
    expect(result.error).not.toContain("incident-hook");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a throwing secrets lookup fails generically instead of throwing", async () => {
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "hooks.example";
    const secrets: SecretsContext = {
      get: async () => {
        throw new Error("corrupt envelope for incident-hook");
      },
      has: async () => true,
      set: async () => {},
      delete: async () => true,
    };

    const result = await performWebhookDispatch(
      {
        url: "http://hooks.example/hook",
        method: "POST",
        headers: {},
        auth: { kind: "bearer", secret: "incident-hook" },
      },
      { tenantId: TEST_TENANT_ID, userId: TEST_USER_ID, secrets },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("webhook auth secret is not available");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an undefined secrets context fails the same generic way as a missing secret", async () => {
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "hooks.example";

    const result = await performWebhookDispatch(
      {
        url: "http://hooks.example/hook",
        method: "POST",
        headers: {},
        auth: { kind: "bearer", secret: "incident-hook" },
      },
      noSecretsDeps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("webhook auth secret is not available");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an invalid url is rejected before any secret is read", async () => {
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    const { secrets, get } = fakeSecrets("should-never-be-read");

    const result = await performWebhookDispatch(
      {
        url: "not-a-url",
        method: "POST",
        headers: {},
        auth: { kind: "bearer", secret: "incident-hook" },
      },
      { tenantId: TEST_TENANT_ID, userId: TEST_USER_ID, secrets },
    );

    expect(result).toEqual({ ok: false, error: "invalid url" });
    expect(get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a failing request never echoes the request url into the delivery error", async () => {
    setWebhookHostLookup(fakeLookupFor({ "secret-host.example": "203.0.113.9" }));
    setWebhookFetch((async () => {
      throw new TypeError("connect ECONNREFUSED https://secret-host.example/hook?token=abc");
    }) as unknown as typeof fetch);

    const result = await performWebhookDispatch(
      { url: "https://secret-host.example/hook?token=abc", method: "POST", headers: {} },
      { tenantId: TEST_TENANT_ID, userId: TEST_USER_ID, secrets: undefined },
    );

    expect(result).toEqual({ ok: false, error: "webhook request failed (TypeError)" });
  });
});
