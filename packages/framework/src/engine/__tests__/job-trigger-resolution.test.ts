import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createRegistry, defineFeature } from "../index.ts";

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
      r.writeHandler({
        name: "place-order",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: signedInAccess,
      });
      r.queryHandler({
        name: "order-report",
        schema: z.object({}),
        handler: async () => [],
        access: signedInAccess,
      });
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
      r.writeHandler({
        name: "create",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: signedInAccess,
      });
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

describe("cron trigger tz", () => {
  function featureWithTz(tz: string) {
    return defineFeature("shop", (r) => {
      r.job("nightly", { trigger: { cron: "0 9 * * *", tz } }, async () => {});
    });
  }

  test("a valid IANA zone is kept on the registered job", () => {
    const registry = createRegistry([featureWithTz("Europe/Berlin")]);
    expect(registry.getJob("shop:job:nightly")?.trigger).toEqual({
      cron: "0 9 * * *",
      tz: "Europe/Berlin",
    });
  });

  test.each(["Mars/Olympus", "europe/berlin", ""])("tz %p is rejected at declaration", (tz) => {
    expect(() => featureWithTz(tz)).toThrow(/r\.job\("nightly"\) declares trigger/);
  });
});

describe("maintenance trigger", () => {
  test("is kept on the registered job", () => {
    const feature = defineFeature("shop", (r) => {
      r.job("tidy", { trigger: { maintenance: true } }, async () => {});
    });
    expect(createRegistry([feature]).getJob("shop:job:tidy")?.trigger).toEqual({
      maintenance: true,
    });
  });

  test.each([false, "03:00", 1])("value %p is rejected at declaration", (value) => {
    expect(() =>
      defineFeature("shop", (r) => {
        r.job("tidy", { trigger: { maintenance: value as never } }, async () => {});
      }),
    ).toThrow(/r\.job\("tidy"\) declares trigger \{ maintenance/);
  });
});
