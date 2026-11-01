import { describe, expect, test } from "bun:test";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { validateScopeEventContracts } from "../scope-events-check.ts";
import type { PatScopeConfig } from "../web/scopes.ts";

const ticketing = defineFeature("ticketing", (r) => {
  r.entity({
    name: "ticket",
    ...createEntity({
      webhookEvents: true,
      fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
    }),
  });
  r.entity({
    name: "note",
    ...createEntity({
      fields: { body: createTextField({ personal: false, reason: "test_fixture" }) },
    }),
  });
  r.defineEvent("internal-note", z.object({ id: z.string() }), { piiFields: "none" });
  r.defineWebhookEvent({
    name: "ticket-closed",
    description: "A ticket was closed.",
    payload: z.object({ id: z.uuid() }),
    version: 1,
  });
});

const scopesWith = (events: readonly string[]): PatScopeConfig => ({
  support: { label: "Support", read: [], events },
});

describe("validateScopeEventContracts", () => {
  test("accepts declared contracts and entity events", () => {
    expect(() =>
      validateScopeEventContracts(scopesWith(["ticketing:ticket-closed", "ticket.created"]), [
        ticketing,
      ]),
    ).not.toThrow();
  });

  test("rejects an internal event and names event, scope and fix", () => {
    expect(() =>
      validateScopeEventContracts(scopesWith(["ticketing:event:internal-note"]), [ticketing]),
    ).toThrow(
      /scope "support" lists event "ticketing:event:internal-note".*r\.defineWebhookEvent/s,
    );
  });

  test("rejects an entity event of an entity without the webhookEvents opt-in", () => {
    expect(() => validateScopeEventContracts(scopesWith(["note.created"]), [ticketing])).toThrow(
      /webhookEvents: true.*entity "note"/s,
    );
  });

  test("rejects an entity event of an unknown entity", () => {
    expect(() => validateScopeEventContracts(scopesWith(["plane.created"]), [ticketing])).toThrow(
      /plane\.created/,
    );
  });
});
