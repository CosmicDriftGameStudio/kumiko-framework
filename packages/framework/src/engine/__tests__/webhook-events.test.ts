import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";
import { createRegistry } from "../registry.ts";
import {
  formatWebhookPayloadIssues,
  parseWebhookPayload,
  toEntityWebhookPayload,
} from "../webhook-events.ts";

const ID = "0b9c6c3a-5c1e-4a6e-9a39-2f1d6c1f7a10";

const carEntity = createEntity({
  table: "webhook_cars",
  webhookEvents: true,
  fields: {
    vin: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    model: createTextField({ personal: false, reason: "test_fixture" }),
    internalNote: createTextField({ personal: false, reason: "test_fixture" }),
    owner: createTextField({ personal: "self", find: "none" }),
  },
});

const garage = defineFeature("garage", (r) => {
  r.entity({ name: "car", ...carEntity });
  r.crud("car", carEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { roles: ["User"] } },
    excludeFields: { create: ["internalNote"] },
  });
  r.defineWebhookEvent({
    name: "car-sold",
    description: "A car was sold.",
    payload: z.object({ id: z.uuid(), price: z.number() }),
    version: 2,
  });
});

const registry = createRegistry([garage]);

describe("defineWebhookEvent", () => {
  test("registers a qualified, versioned contract outside the internal events", () => {
    expect(garage.webhookEvents?.["garage:car-sold"]?.version).toBe(2);
    expect(garage.events?.["garage:car-sold"]).toBeUndefined();
    const contract = registry.getWebhookEventContract("garage:car-sold");
    expect(contract).toMatchObject({
      qn: "garage:car-sold",
      origin: "declared",
      description: "A car was sold.",
    });
  });

  test("wireName defaults to the unqualified name, derived entity events keep entity.verb", () => {
    expect(registry.getWebhookEventContract("garage:car-sold")?.wireName).toBe("car-sold");
    expect(registry.getWebhookEventContract("car.created")?.wireName).toBe("car.created");
    const renamed = defineFeature("shop", (r) => {
      r.defineWebhookEvent({
        name: "order-paid",
        wireName: "order.paid",
        description: "An order was paid.",
        payload: z.object({ id: z.uuid() }),
        version: 1,
      });
    });
    expect(createRegistry([renamed]).getWebhookEventContract("shop:order-paid")?.wireName).toBe(
      "order.paid",
    );
  });

  test("two contracts with the same wire name fail the registry and name both QNs", () => {
    const declare = (feature: string, name: string, wireName: string) =>
      defineFeature(feature, (r) => {
        r.defineWebhookEvent({
          name,
          wireName,
          description: "Something happened.",
          payload: z.object({ id: z.uuid() }),
          version: 1,
        });
      });
    expect(() =>
      createRegistry([
        declare("shop", "paid", "order.paid"),
        declare("billing", "ok", "order.paid"),
      ]),
    ).toThrow(/"order\.paid" is used by both "shop:paid" and "billing:ok"/);
    expect(() => createRegistry([garage, declare("fleet", "made", "car.created")])).toThrow(
      /"car\.created" is used by both "fleet:made" and "car\.created"|"car\.created" is used by both "car\.created" and "fleet:made"/,
    );
  });

  test("rejects an empty wireName", () => {
    expect(() =>
      defineFeature("shop", (r) => {
        r.defineWebhookEvent({
          name: "order-paid",
          wireName: " ",
          description: "An order was paid.",
          payload: z.object({ id: z.uuid() }),
          version: 1,
        });
      }),
    ).toThrow(/wireName must be a non-empty string/);
  });

  test("returns a handle carrying the qualified name", () => {
    let handleName = "";
    defineFeature("shop", (r) => {
      handleName = r.defineWebhookEvent({
        name: "order-paid",
        description: "An order was paid.",
        payload: z.object({ id: z.uuid() }),
        version: 1,
      }).name;
    });
    expect(handleName).toBe("shop:order-paid");
  });

  test("getWebhookEventContracts lists declared contracts sorted by qualified name", () => {
    const feature = defineFeature("zeta", (r) => {
      for (const name of ["b-event", "a-event"]) {
        r.defineWebhookEvent({ name, description: "x.", payload: z.object({}), version: 1 });
      }
    });
    expect(
      createRegistry([feature, garage])
        .getWebhookEventContracts()
        .map((contract) => contract.qn),
    ).toEqual(["garage:car-sold", "zeta:a-event", "zeta:b-event"]);
  });

  test("rejects a duplicate name in the same feature", () => {
    expect(() =>
      defineFeature("dup", (r) => {
        const definition = { name: "x-y", description: "d.", payload: z.object({}), version: 1 };
        r.defineWebhookEvent(definition);
        r.defineWebhookEvent(definition);
      }),
    ).toThrow(/already registered/);
  });

  const register = (definition: Record<string, unknown>) => () =>
    defineFeature("bad", (r) => {
      r.defineWebhookEvent({
        name: "ok-name",
        description: "d.",
        payload: z.object({}),
        version: 1,
        ...definition,
      });
    });

  test.each([
    [{ name: "NotKebab" }, /kebab-case/],
    [{ description: " " }, /description/],
    [{ payload: z.string() }, /zod object/],
    [{ version: 0 }, /positive integer/],
    [{ version: 1.5 }, /positive integer/],
  ])("rejects invalid input %#", (definition, message) => {
    expect(register(definition)).toThrow(message);
  });

  test("rejects the positional call form", () => {
    expect(() =>
      defineFeature("bad", (r) => {
        // @ts-expect-error positional form is not supported
        r.defineWebhookEvent("x-y", "d.", z.object({}), 1);
      }),
    ).toThrow(/object/);
  });
});

describe("derived entity contracts", () => {
  const shape = (qn: string) =>
    Object.keys(registry.getWebhookEventContract(qn)?.payload.shape ?? {});

  test("created carries the releasable fields without PII and excluded fields", () => {
    expect(shape("car.created").sort()).toEqual(["id", "model", "vin"]);
    expect(registry.getWebhookEventContract("car.created")).toMatchObject({
      origin: "entity",
      entity: "car",
      verb: "created",
      version: 1,
    });
  });

  test("updated carries changes and the previous row with its id", () => {
    expect(shape("car.updated").sort()).toEqual(["changes", "id", "previous"]);
    const result = parseWebhookPayload(registry.getWebhookEventContract("car.updated")!, {
      id: ID,
      changes: { model: "T", owner: "leak" },
      previous: { id: ID, vin: "V1", owner: "leak" },
    });
    expect(result).toEqual({
      ok: true,
      payload: { id: ID, changes: { model: "T" }, previous: { id: ID, vin: "V1" } },
    });
  });

  test("deleted carries the id and the previous row", () => {
    expect(shape("car.deleted").sort()).toEqual(["id", "previous"]);
  });

  test.each(["created", "updated", "deleted"] as const)(
    "toEntityWebhookPayload maps a stored %s event and drops personal fields",
    (verb) => {
      const stored =
        verb === "created"
          ? { vin: "V1", model: "T", owner: "leak" }
          : {
              changes: { model: "T", owner: "leak" },
              previous: { id: ID, vin: "V1", owner: "leak" },
            };
      const result = toEntityWebhookPayload(registry.getWebhookEventContract(`car.${verb}`)!, {
        aggregateId: ID,
        payload: stored,
      });
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toContain("leak");
      expect(result.ok && result.payload["id"]).toBe(ID);
    },
  );

  test("unknown entity or verb has no contract", () => {
    expect(registry.getWebhookEventContract("plane.created")).toBeUndefined();
    expect(registry.getWebhookEventContract("car.renamed")).toBeUndefined();
    expect(registry.getWebhookEventContract("garage:car:created")).toBeUndefined();
  });
});

describe("parseWebhookPayload", () => {
  const contract = registry.getWebhookEventContract("garage:car-sold")!;

  test("strips keys the contract does not declare", () => {
    expect(parseWebhookPayload(contract, { id: ID, price: 5, email: "a@b.c" })).toEqual({
      ok: true,
      payload: { id: ID, price: 5 },
    });
  });

  test("reports every violation with its path", () => {
    const result = parseWebhookPayload(contract, { id: "nope" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path).sort()).toEqual(["id", "price"]);
    expect(formatWebhookPayloadIssues(result.issues)).toContain("price:");
  });
});
