import { describe, expect, test } from "bun:test";
import { createSecret, type SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { makeRuntimes, stubCtx, TEST_CLIENT_TOKEN } from "./paddle-test-kit.ts";

function rawSecrets(value: string): SecretsContext {
  return {
    get: async () => createSecret(value),
    has: async () => true,
    set: async () => undefined,
    delete: async () => false,
    withRunner: () => {
      throw new Error("withRunner is not used by this test");
    },
  };
}

describe("PaddleWebhookRuntime", () => {
  test("a JSON-encoded stored secret is parsed back", async () => {
    const runtimes = makeRuntimes(async () => new Response("{}"), {});
    expect(
      await runtimes.webhook.resolveWebhookSecret(rawSecrets(JSON.stringify("pdl_ntfset_stored"))),
    ).toBe("pdl_ntfset_stored");
    expect(
      await runtimes.webhook.resolveTenantBindingKey(rawSecrets(JSON.stringify("stored-binding"))),
    ).toBe("stored-binding");
  });

  test("a non-JSON stored secret throws without repeating the value", async () => {
    const runtimes = makeRuntimes(async () => new Response("{}"), {});
    const failure = await runtimes.webhook
      .resolveWebhookSecret(rawSecrets("pdl_ntfset_AbC123"))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) return;
    expect(failure.message).toBe(
      "subscription-paddle credential (backing:secrets) is not valid JSON",
    );
    expect(failure.message).not.toContain("pdl_ntfset_AbC123");
    expect(failure.cause).toBeUndefined();
  });

  test("without a stored secret the factory fallback is used, without either it throws", async () => {
    const withFallback = makeRuntimes(async () => new Response("{}"), {
      webhookSecret: "fallback",
    });
    expect(await withFallback.webhook.resolveWebhookSecret()).toBe("fallback");
    const without = makeRuntimes(async () => new Response("{}"), {});
    await expect(without.webhook.resolveWebhookSecret()).rejects.toThrow(/unresolved/);
    await expect(without.webhook.resolveTenantBindingKey()).rejects.toThrow(/unresolved/);
  });
});

describe("readCheckoutConfig", () => {
  test("answers the fallback client token and the environment", async () => {
    const runtimes = makeRuntimes(async () => new Response("{}"));
    expect(await runtimes.readCheckoutConfig(stubCtx({ environment: "live" }))).toEqual({
      clientToken: TEST_CLIENT_TOKEN,
      environment: "live",
    });
  });

  test("answers no token when none is configured and defaults to sandbox", async () => {
    const runtimes = makeRuntimes(async () => new Response("{}"), {});
    expect(await runtimes.readCheckoutConfig(stubCtx())).toEqual({
      clientToken: null,
      environment: "sandbox",
    });
  });
});
