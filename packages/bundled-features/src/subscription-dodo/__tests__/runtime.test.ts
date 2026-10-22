import { describe, expect, test } from "bun:test";
import { createSecret, type SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { makeRuntimes } from "./dodo-test-kit.ts";

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

describe("DodoWebhookRuntime.resolveWebhookSecret", () => {
  test("a JSON-encoded stored secret is parsed back", async () => {
    const runtimes = makeRuntimes(async () => new Response("{}"), {});
    expect(
      await runtimes.webhook.resolveWebhookSecret(rawSecrets(JSON.stringify("whsec_stored"))),
    ).toBe("whsec_stored");
  });

  test("a non-JSON stored secret throws without repeating the value", async () => {
    const runtimes = makeRuntimes(async () => new Response("{}"), {});
    const failure = await runtimes.webhook
      .resolveWebhookSecret(rawSecrets("whsec_AbC123"))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) return;
    expect(failure.message).toBe(
      "subscription-dodo credential (backing:secrets) is not valid JSON",
    );
    expect(failure.message).not.toContain("whsec_AbC123");
    expect(failure.cause).toBeUndefined();
  });
});
