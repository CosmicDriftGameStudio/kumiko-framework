import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../define-feature.js";
import { createEventDef } from "../event-def.js";
import type { EventDef } from "../types/index.js";

const invoiceSentSchema = z.object({
  invoiceId: z.string(),
  email: z.string(),
  ownerId: z.string(),
});
const invoiceSentPii = { email: { personal: { of: "ownerId" } } } as const;

describe("createEventDef", () => {
  test("matches the EventDef r.defineEvent returns for the same input", () => {
    let registered: EventDef | undefined;
    const feature = defineFeature("billingDesk", (r) => {
      registered = r.defineEvent("invoiceSent", invoiceSentSchema, {
        version: 2,
        piiFields: invoiceSentPii,
      });
    });
    const standalone = createEventDef({
      feature: "billingDesk",
      name: "invoiceSent",
      schema: invoiceSentSchema,
      version: 2,
      piiFields: invoiceSentPii,
    });

    for (const def of [registered, feature.events["invoiceSent"]]) {
      expect(def?.name).toBe(standalone.name);
      expect(def?.schema).toBe(standalone.schema);
      expect(def?.version).toBe(standalone.version);
      expect(def?.piiFields).toEqual(standalone.piiFields);
    }
    expect(standalone.name).toBe("billing-desk:event:invoice-sent");
  });

  test("defaults the version to 1", () => {
    const def = createEventDef({
      feature: "desk",
      name: "opened",
      schema: z.object({}),
      piiFields: "none",
    });
    expect(def.version).toBe(1);
  });

  test("rejects the same misconfigurations as r.defineEvent", () => {
    expect(() =>
      createEventDef({ feature: "desk", name: "opened", schema: z.object({}), piiFields: {} }),
    ).toThrow("piiFields: {} is not a stance");
    expect(() =>
      createEventDef({
        feature: "desk",
        name: "opened",
        schema: z.object({}),
        version: 0,
        piiFields: "none",
      }),
    ).toThrow("version must be a positive integer");
    expect(() =>
      createEventDef({
        feature: "desk",
        name: "opened",
        schema: z.object({ email: z.string() }),
        piiFields: { email: { personal: { of: "ownerId" } } },
      }),
    ).toThrow('piiFields references "ownerId"');
  });
});
