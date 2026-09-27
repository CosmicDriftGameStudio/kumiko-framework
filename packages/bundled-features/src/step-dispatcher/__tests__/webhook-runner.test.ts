// Host-egress guard tests for performWebhookDispatch — spec.url is
// request-controlled (see webhook-runner.ts header), so it must resolve to
// a public address before any connect is attempted, mirroring the SMTP/
// IMAP host guard.

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { lookup } from "node:dns/promises";
import {
  performWebhookDispatch,
  setWebhookFetch,
  setWebhookHostLookup,
  WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
} from "../webhook-runner";

function fakeLookupFor(addressesByHost: Readonly<Record<string, string>>): typeof lookup {
  return (async (hostname: string) => {
    const address = addressesByHost[hostname];
    if (!address) throw new Error(`ENOTFOUND ${hostname}`);
    return [{ address, family: 4 }];
  }) as unknown as typeof lookup;
}

const fetchMock = mock<typeof fetch>();

afterEach(() => {
  fetchMock.mockReset();
  setWebhookFetch(fetch);
  setWebhookHostLookup(undefined);
  delete process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
});

describe("performWebhookDispatch — host-egress guard", () => {
  test("a private IP-literal host is rejected before any connect attempt", async () => {
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    const result = await performWebhookDispatch({
      url: "http://10.0.0.5/hook",
      method: "POST",
      headers: {},
    });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a hostname resolving to a private address is rejected, without leaking the resolved address", async () => {
    setWebhookHostLookup(fakeLookupFor({ "internal.example": "127.0.0.1" }));
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    const result = await performWebhookDispatch({
      url: "http://internal.example/hook",
      method: "POST",
      headers: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("127.0.0.1");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a DNS resolution failure surfaces as a delivery error, not a thrown exception", async () => {
    setWebhookHostLookup(fakeLookupFor({}));
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    const result = await performWebhookDispatch({
      url: "http://nowhere.example/hook",
      method: "POST",
      headers: {},
    });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an operator-allowlisted private host bypasses resolution and keeps its raw url", async () => {
    process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "webhook-receiver.internal";
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await performWebhookDispatch({
      url: "http://webhook-receiver.internal/hook",
      method: "POST",
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe("http://webhook-receiver.internal/hook");
  });

  test("a public hostname is pinned to its resolved address, keeping the original host as Host header and TLS SNI", async () => {
    setWebhookHostLookup(fakeLookupFor({ "hooks.example.com": "203.0.113.9" }));
    setWebhookFetch(fetchMock as unknown as typeof fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await performWebhookDispatch({
      url: "https://hooks.example.com/incident",
      method: "POST",
      headers: {},
    });

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
