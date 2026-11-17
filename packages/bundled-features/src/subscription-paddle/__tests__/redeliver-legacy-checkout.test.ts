import { describe, expect, test } from "bun:test";
import type { SignatureExtraRouteDeps } from "@cosmicdrift/kumiko-framework/api";
import type { WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  InternalError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { shouldRedeliverLegacyCheckout } from "../redeliver-legacy-checkout.ts";
import { verifyAndParsePaddleWebhook } from "../webhook-events.ts";
import {
  createSendMock,
  envelope,
  makeRuntimes,
  NOW_SECONDS,
  webhookHeaders,
} from "./paddle-test-kit.ts";

const NOW = Temporal.Instant.from("2026-11-02T12:00:00Z");

function depsWithMarker(result: WriteResult): SignatureExtraRouteDeps {
  return {
    dispatchWriteAs: async () => result,
  } as unknown as SignatureExtraRouteDeps; // @cast-boundary test-stub — only dispatchWriteAs is used
}

async function parsedEvent(customData: Record<string, unknown>) {
  const verify = verifyAndParsePaddleWebhook(makeRuntimes(createSendMock().send).webhook, {
    priceToTier: {},
    oneOffPriceIds: ["pri_topup"],
    nowSeconds: () => NOW_SECONDS,
  });
  const body = envelope(
    "transaction.completed",
    {
      id: "txn_1",
      subscription_id: null,
      customer_id: "ctm_1",
      custom_data: customData,
      items: [{ price: { id: "pri_topup" } }],
    },
    "evt_1",
  );
  const event = await verify(body, webhookHeaders({ timestamp: String(NOW_SECONDS), body }));
  if (event === null) throw new Error("expected a parsed event");
  return event;
}

const marker = (completedAt: string | null): WriteResult => ({
  isSuccess: true,
  data: { completedAt },
});

describe("shouldRedeliverLegacyCheckout", () => {
  const tenantId = "00000000-0000-4000-8000-000000000001";

  test("no marker yet: the sweep has not run, redeliver", async () => {
    const event = await parsedEvent({ tenantId, tenantBinding: "b" });
    expect(
      await shouldRedeliverLegacyCheckout({
        event,
        reason: "checkout_not_in_ledger",
        deps: depsWithMarker(marker(null)),
        now: () => NOW,
      }),
    ).toBe(true);
  });

  test("marker younger than an hour: redeliver; one hour or older: answer 200", async () => {
    const event = await parsedEvent({ tenantId, tenantBinding: "b" });
    const ask = (completedAt: string) =>
      shouldRedeliverLegacyCheckout({
        event,
        reason: "checkout_not_in_ledger",
        deps: depsWithMarker(marker(completedAt)),
        now: () => NOW,
      });
    expect(await ask("2026-11-02T11:00:01Z")).toBe(true);
    expect(await ask("2026-11-02T11:00:00Z")).toBe(false);
  });

  test("marker dispatch fails internally: redeliver, Paddle retries only a bounded number of times", async () => {
    const event = await parsedEvent({ tenantId, tenantBinding: "b" });
    const failed = writeFailure(new InternalError({ message: "db down" }));
    expect(
      await shouldRedeliverLegacyCheckout({
        event,
        reason: "checkout_not_in_ledger",
        deps: depsWithMarker(failed),
        now: () => NOW,
      }),
    ).toBe(true);
  });

  test("marker dispatch denied: answer 200 instead of an endless 503", async () => {
    const event = await parsedEvent({ tenantId, tenantBinding: "b" });
    const failed = writeFailure(new AccessDeniedError({}));
    expect(
      await shouldRedeliverLegacyCheckout({
        event,
        reason: "checkout_not_in_ledger",
        deps: depsWithMarker(failed),
        now: () => NOW,
      }),
    ).toBe(false);
  });

  test("an event without tenantBinding never asks for redelivery", async () => {
    const event = await parsedEvent({ tenantId });
    expect(
      await shouldRedeliverLegacyCheckout({
        event,
        reason: "checkout_not_in_ledger",
        deps: depsWithMarker(marker(null)),
        now: () => NOW,
      }),
    ).toBe(false);
  });
});
