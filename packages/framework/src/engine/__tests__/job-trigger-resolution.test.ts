import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEntity, createRegistry, createTextField, defineFeature } from "../index.ts";

const signedInAccess = { openToAll: { reason: "test handler callable by any signed-in user" } };

function triggerOnOf(registry: ReturnType<typeof createRegistry>, jobQn: string): unknown {
  const job = registry.getJob(jobQn);
  if (job === undefined || !("on" in job.trigger))
    throw new Error(`job ${jobQn} has no on-trigger`);
  return job.trigger.on;
}

const orderEntity = createEntity({
  name: "order",
  table: "read_shop_orders",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});

describe("job trigger resolution", () => {
  test("short and qualified event names and entity lifecycle events resolve", () => {
    const feature = defineFeature("shop", (r) => {
      r.crud(orderEntity, { write: { access: signedInAccess }, read: { access: signedInAccess } });
      r.defineEvent("order-shipped", z.object({ orderId: z.string() }), { piiFields: "none" });
      r.job({ name: "on-event", trigger: { on: "order-shipped" }, handler: async () => {} });
      r.job({ name: "on-entity", trigger: { on: "order.created" }, handler: async () => {} });
      r.job({ name: "on-many", trigger: { on: ["order.created", "shop:event:order-shipped"] }, handler: async () => {} });
    });

    const registry = createRegistry([feature]);

    expect(triggerOnOf(registry, "shop:job:on-event")).toBe("shop:event:order-shipped");
    expect(triggerOnOf(registry, "shop:job:on-entity")).toBe("order.created");
    expect(triggerOnOf(registry, "shop:job:on-many")).toEqual([
      "order.created",
      "shop:event:order-shipped",
    ]);
  });

  test("a handler QN as trigger fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.writeHandler({
        name: "place-order",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: signedInAccess,
      });
      r.job({ name: "on-write", trigger: { on: "shop:write:place-order" }, handler: async () => {} });
    });

    expect(() => createRegistry([feature])).toThrow("Jobs trigger on events only");
  });

  test("a handler short name as trigger fails boot the same way", () => {
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
      r.job({ name: "on-write", trigger: { on: "place-order" }, handler: async () => {} });
      r.job({ name: "on-query", trigger: { on: "order-report" }, handler: async () => {} });
    });

    expect(() => createRegistry([feature])).toThrow("Jobs trigger on events only");
  });

  test.each(["order.archived", "ghost.created"])(
    "an unknown entity event %p fails boot",
    (trigger) => {
      const feature = defineFeature("shop", (r) => {
        r.crud(orderEntity, { write: { access: signedInAccess }, read: { access: signedInAccess } });
        r.job({ name: "on-unknown", trigger: { on: trigger }, handler: async () => {} });
      });

      expect(() => createRegistry([feature])).toThrow("no event with that name exists");
    },
  );

  test("catchUp on an entity event fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.crud(orderEntity, { write: { access: signedInAccess }, read: { access: signedInAccess } });
      r.job({ name: "replay", trigger: { on: "order.created", catchUp: true }, handler: async () => {} });
    });

    expect(() => createRegistry([feature])).toThrow(/catchUp/);
  });

  test("a fully qualified cross-feature trigger stays as declared", () => {
    const orders = defineFeature("orders", (r) => {
      r.defineEvent("created", z.object({}), { piiFields: "none" });
    });
    const mailer = defineFeature("mailer", (r) => {
      r.job({ name: "confirm", trigger: { on: "orders:event:created" }, handler: async () => {} });
    });

    const registry = createRegistry([orders, mailer]);

    expect(triggerOnOf(registry, "mailer:job:confirm")).toBe("orders:event:created");
  });

  test("an unknown trigger fails boot and lists every name it tried", () => {
    const feature = defineFeature("shop", (r) => {
      r.job({ name: "typo", trigger: { on: "plase-order" }, handler: async () => {} });
    });

    expect(() => createRegistry([feature])).toThrow(
      'Job "shop:job:typo" triggers on "plase-order" but no event with that name exists. ' +
        'Tried: "plase-order", "shop:event:plase-order"',
    );
  });
});

describe("cron trigger tz", () => {
  function featureWithTz(tz: string) {
    return defineFeature("shop", (r) => {
      r.job({ name: "nightly", trigger: { cron: "0 9 * * *", tz }, handler: async () => {} });
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
      r.job({ name: "tidy", trigger: { maintenance: true }, handler: async () => {} });
    });
    expect(createRegistry([feature]).getJob("shop:job:tidy")?.trigger).toEqual({
      maintenance: true,
    });
  });

  test.each([false, "03:00", 1])("value %p is rejected at declaration", (value) => {
    expect(() =>
      defineFeature("shop", (r) => {
        r.job({ name: "tidy", trigger: { maintenance: value as never }, handler: async () => {} });
      }),
    ).toThrow(/r\.job\("tidy"\) declares trigger \{ maintenance/);
  });
});
