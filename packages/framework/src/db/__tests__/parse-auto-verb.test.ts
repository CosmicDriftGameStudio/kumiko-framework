// Unit tests for parseAutoVerb — the mapping logic that determines
// whether an event is an auto-verb on its aggregate (created/
// updated/deleted/restored) or a domain event. In production,
// ImplicitProjection registers apply handlers only for the four auto-
// verbs; domain events go through explicit r.projection or MSP.
//
// If parseAutoVerb incorrectly returned a verb for a domain event,
// ImplicitProjection would fire the wrong handler.

import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/index.ts";
import type { StoredEvent } from "../../event-store/index.ts";
import { parseAutoVerb } from "../apply-entity-event.ts";

function event(overrides: Partial<StoredEvent>): StoredEvent {
  return {
    id: "evt-1",
    aggregateId: "agg-1",
    aggregateType: "user",
    tenantId: "tenant-1" as never,
    version: 1,
    type: "user.created",
    eventVersion: 1,
    payload: {},
    metadata: { userId: "u-1" },
    createdAt: { toString: () => "2026-04-27T00:00:00Z" } as never,
    createdBy: "u-1",
    ...overrides,
  };
}

describe("parseAutoVerb", () => {
  test.each([
    ["user.created", "created"],
    ["user.updated", "updated"],
    ["user.deleted", "deleted"],
    ["user.restored", "restored"],
  ] as const)("'%s' → '%s'", (type, verb) => {
    expect(parseAutoVerb(event({ type }), undefined)).toBe(verb);
  });

  test("domain event on the same aggregate → null", () => {
    expect(parseAutoVerb(event({ type: "user.password-changed" }), undefined)).toBeNull();
  });

  test("auto-verb suffix on the wrong aggregate → null", () => {
    // type "tenant.created" on a user aggregate is defensively treated as a
    // domain event by the user ImplicitProjection, not as its own auto-verb.
    expect(
      parseAutoVerb(event({ aggregateType: "user", type: "tenant.created" }), undefined),
    ).toBeNull();
  });

  test("kebab-case Aggregate (incident-update.created)", () => {
    expect(
      parseAutoVerb(
        event({ aggregateType: "incident-update", type: "incident-update.created" }),
        undefined,
      ),
    ).toBe("created");
  });

  test("custom verb → null", () => {
    expect(parseAutoVerb(event({ type: "user.imported" }), undefined)).toBeNull();
  });

  test("type without dot separator → null", () => {
    expect(parseAutoVerb(event({ type: "userCreated" }), undefined)).toBeNull();
  });

  test("type with nested prefix → null", () => {
    // "user.profile.updated" has two dots, so it is not a clean auto-verb
    expect(parseAutoVerb(event({ type: "user.profile.updated" }), undefined)).toBeNull();
  });

  describe("declared entity verbs", () => {
    const withVerbs = createEntity({
      name: "user",
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      verbs: { archived: {} },
    });
    const withoutVerbs = createEntity({
      name: "user",
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    });

    test("a declared verb parses as updated", () => {
      expect(parseAutoVerb(event({ type: "user.archived" }), withVerbs)).toBe("updated");
    });

    test("an undeclared verb stays a domain event", () => {
      expect(parseAutoVerb(event({ type: "user.archived" }), withoutVerbs)).toBeNull();
    });

    test("an inherited object key is not a declared verb", () => {
      expect(parseAutoVerb(event({ type: "user.toString" }), withVerbs)).toBeNull();
    });

    test("a lifecycle verb keeps its own meaning with an entity", () => {
      expect(parseAutoVerb(event({ type: "user.created" }), withVerbs)).toBe("created");
    });
  });
});
