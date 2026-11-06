import { describe, expect, test } from "bun:test";
import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { runBackfillCheckoutLedger } from "../backfill-checkout-ledger.ts";
import { createSendMock, makeRuntimes } from "./paddle-test-kit.ts";

describe("runBackfillCheckoutLedger without a Paddle API key", () => {
  test("does nothing: no marker read, no Paddle call", async () => {
    const paddle = createSendMock();
    let dispatched = 0;
    const ctx = {
      services: { extensions: {} },
      systemUser: { id: "system" },
      dispatch: {
        write: async () => {
          dispatched += 1;
        },
      },
    } as unknown as JobContext; // @cast-boundary test-stub — partial ctx

    await runBackfillCheckoutLedger(ctx, {
      runtime: makeRuntimes(paddle.send, {}).ctx,
      priceToTier: {},
    });

    expect(dispatched).toBe(0);
    expect(paddle.calls).toHaveLength(0);
  });
});

describe("runBackfillCheckoutLedger without a legacy tenant binding key", () => {
  test("still ledgers a legacy checkout, since a paid checkout must not be lost", async () => {
    const paddle = createSendMock(() => ({
      body: {
        data: [
          {
            id: "txn_legacy",
            custom_data: { tenantId: "11111111-1111-4111-8111-111111111111", tenantBinding: "x" },
            items: [{ price: { id: "pri_pro" } }],
          },
        ],
      },
    }));
    const ledgered: unknown[] = [];
    const ctx = {
      services: { extensions: {} },
      systemUser: { id: "system" },
      tz: { now: () => Temporal.Instant.from("2026-11-06T10:00:00Z") },
      dispatch: {
        write: async () => ({ isSuccess: true, data: { completedAt: null } }),
        writeAs: async (_user: unknown, _qn: string, payload: unknown) => {
          ledgered.push(payload);
          return { isSuccess: true };
        },
      },
    } as unknown as JobContext; // @cast-boundary test-stub — partial ctx

    await runBackfillCheckoutLedger(ctx, {
      runtime: makeRuntimes(paddle.send).ctx,
      priceToTier: { pri_pro: "pro" },
    });

    expect(ledgered).toMatchObject([{ providerCheckoutId: "txn_legacy", mode: "subscription" }]);
  });
});
