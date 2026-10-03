import { beforeEach, describe, expect, mock, test } from "bun:test";
import { BlockedHostError } from "@cosmicdrift/kumiko-framework/http";
import { postChatWebhook } from "../chat-webhook-sender.js";

const sendSpy = mock(async (_url: string, _init: RequestInit) => new Response("ok"));

beforeEach(() => {
  sendSpy.mockReset();
  sendSpy.mockImplementation(async () => new Response("ok"));
});

const slackHosts = ["hooks.slack.com"];
const teamsHosts = [".webhook.office.com", ".logic.azure.com", ".powerplatform.com"];

function post(url: string, allowedHosts: readonly string[], requiredPathPrefix?: string) {
  return postChatWebhook({
    url,
    allowedHosts,
    requireHttps: true,
    ...(requiredPathPrefix !== undefined && { requiredPathPrefix }),
    timeoutMs: 1000,
    body: {},
    send: sendSpy,
  });
}

describe("postChatWebhook allowlist (checked on the parsed URL)", () => {
  test.each([
    ["look-alike subdomain suffix", "https://hooks.slack.com.evil.com/services/T/B/x", slackHosts],
    ["suffix without a dot boundary", "https://evilwebhook.office.com/webhookb2/x", teamsHosts],
    ["userinfo naming an allowed host", "https://hooks.slack.com@evil.com/services/x", slackHosts],
    ["userinfo with credentials", "https://user:pass@hooks.slack.com/services/x", slackHosts],
    ["http while https is required", "http://hooks.slack.com/services/x", slackHosts],
    ["the bare suffix domain itself", "https://webhook.office.com/x", teamsHosts],
    ["unparsable url", "not a url", slackHosts],
  ])("%s -> host_not_allowed, no request", async (_label, url, hosts) => {
    expect(await post(url, hosts)).toEqual({ ok: false, code: "host_not_allowed" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("discord webhook path prefix is enforced", async () => {
    const hosts = ["discord.com", "discordapp.com"];
    expect(await post("https://discord.com/channels/1/2", hosts, "/api/webhooks/")).toEqual({
      ok: false,
      code: "host_not_allowed",
    });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await post("https://discord.com/api/webhooks/1/abc", hosts, "/api/webhooks/")).toEqual({
      ok: true,
    });
  });

  test("exact host and dot-suffix subdomain pass", async () => {
    expect(await post("https://hooks.slack.com/services/T/B/x", slackHosts)).toEqual({ ok: true });
    expect(await post("https://acme.webhook.office.com/webhookb2/x", teamsHosts)).toEqual({
      ok: true,
    });
  });

  test("a throwing send becomes network_error without leaking the URL", async () => {
    const secretUrl = "https://hooks.slack.com/services/SECRET";
    sendSpy.mockImplementation(async () => {
      throw new Error(`connect ECONNREFUSED ${secretUrl}`, { cause: new Error(secretUrl) });
    });
    const result = await post(secretUrl, slackHosts);
    expect(result).toEqual({ ok: false, code: "network_error" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  test("a timeout error maps to timeout", async () => {
    sendSpy.mockImplementation(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(await post("https://hooks.slack.com/services/x", slackHosts)).toEqual({
      ok: false,
      code: "timeout",
    });
  });

  test("a blocked-host verdict from egress maps to host_not_allowed", async () => {
    sendSpy.mockImplementation(async () => {
      throw new BlockedHostError("egress: host resolves to a non-public address: hooks.slack.com");
    });
    expect(await post("https://hooks.slack.com/services/x", slackHosts)).toEqual({
      ok: false,
      code: "host_not_allowed",
    });
  });

  test("a 3xx answer maps to redirect_blocked, other statuses to http_<n>", async () => {
    sendSpy.mockImplementation(async () => new Response(null, { status: 302 }));
    expect(await post("https://hooks.slack.com/services/x", slackHosts)).toEqual({
      ok: false,
      code: "redirect_blocked",
    });
    sendSpy.mockImplementation(async () => new Response("boom", { status: 500 }));
    expect(await post("https://hooks.slack.com/services/x", slackHosts)).toEqual({
      ok: false,
      code: "http_500",
    });
  });

  test("a non-default port over https is rejected, request carries a timeout signal", async () => {
    expect(await post("https://hooks.slack.com:8443/services/x", slackHosts)).toEqual({
      ok: false,
      code: "host_not_allowed",
    });
    expect(sendSpy).not.toHaveBeenCalled();
    await post("https://hooks.slack.com/services/x", slackHosts);
    const init = sendSpy.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
