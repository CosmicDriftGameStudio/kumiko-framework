import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createRegistry, defineFeature } from "../index.js";

const signedInAccess = { openToAll: { reason: "test handler callable by any signed-in user" } };

function triggerOnOf(registry: ReturnType<typeof createRegistry>, jobQn: string): unknown {
  const job = registry.getJob(jobQn);
  if (job === undefined || !("on" in job.trigger))
    throw new Error(`job ${jobQn} has no on-trigger`);
  return job.trigger.on;
}

describe("job trigger resolution", () => {
  test("short write-handler, query-handler and event names resolve to the feature's QNs", () => {
    const feature = defineFeature("shop", (r) => {
      r.writeHandler(
        "place-order",
        z.object({}),
        async () => ({ isSuccess: true as const, data: null }),
        { access: signedInAccess },
      );
      r.queryHandler("order-report", z.object({}), async () => [], { access: signedInAccess });
      r.defineEvent("order-shipped", z.object({ orderId: z.string() }), { piiFields: "none" });
      r.job("on-write", { trigger: { on: "place-order" } }, async () => {});
      r.job("on-query", { trigger: { on: "order-report" } }, async () => {});
      r.job("on-event", { trigger: { on: "order-shipped" } }, async () => {});
      r.job(
        "on-many",
        { trigger: { on: ["placeOrder", "shop:event:order-shipped"] } },
        async () => {},
      );
    });

    const registry = createRegistry([feature]);

    expect(triggerOnOf(registry, "shop:job:on-write")).toBe("shop:write:place-order");
    expect(triggerOnOf(registry, "shop:job:on-query")).toBe("shop:query:order-report");
    expect(triggerOnOf(registry, "shop:job:on-event")).toBe("shop:event:order-shipped");
    expect(triggerOnOf(registry, "shop:job:on-many")).toEqual([
      "shop:write:place-order",
      "shop:event:order-shipped",
    ]);
  });

  test("a fully qualified cross-feature trigger stays as declared", () => {
    const orders = defineFeature("orders", (r) => {
      r.writeHandler(
        "create",
        z.object({}),
        async () => ({ isSuccess: true as const, data: null }),
        { access: signedInAccess },
      );
    });
    const mailer = defineFeature("mailer", (r) => {
      r.job("confirm", { trigger: { on: "orders:write:create" } }, async () => {});
    });

    const registry = createRegistry([orders, mailer]);

    expect(triggerOnOf(registry, "mailer:job:confirm")).toBe("orders:write:create");
  });

  test("an unknown trigger fails boot and lists every name it tried", () => {
    const feature = defineFeature("shop", (r) => {
      r.job("typo", { trigger: { on: "plase-order" } }, async () => {});
    });

    expect(() => createRegistry([feature])).toThrow(
      'Job "shop:job:typo" triggers on "plase-order" but no handler or event with that name exists. ' +
        'Tried: "plase-order", "shop:write:plase-order", "shop:query:plase-order", "shop:event:plase-order"',
    );
  });
});
