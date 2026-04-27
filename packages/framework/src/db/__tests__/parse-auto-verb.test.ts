// Unit-Tests für parseAutoVerb — die Mapping-Logik die entscheidet
// ob ein Event ein Auto-Verb auf seinem Aggregate ist (created/
// updated/deleted/restored) oder ein Domain-Event. Production-Behavior:
// die ImplicitProjection registriert Apply-Handler nur für die 4 Auto-
// Verben; Domain-Events laufen durch explicit r.projection oder MSP.
//
// Wenn parseAutoVerb für ein Domain-Event versehentlich einen Verb
// returnt, würde die ImplicitProjection den falschen Handler firen.

import { describe, expect, test } from "vitest";
import type { StoredEvent } from "../../event-store";
import { parseAutoVerb } from "../apply-entity-event";

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
    expect(parseAutoVerb(event({ type }))).toBe(verb);
  });

  test("domain-event auf demselben aggregate → null", () => {
    expect(parseAutoVerb(event({ type: "user.password-changed" }))).toBeNull();
  });

  test("auto-verb-Suffix auf falschem aggregate → null", () => {
    // type "tenant.created" auf einem user-Aggregate ist defensive ein
    // Domain-Event aus Sicht der user-Implicit-Projection — nicht ihr
    // eigener Auto-Verb.
    expect(parseAutoVerb(event({ aggregateType: "user", type: "tenant.created" }))).toBeNull();
  });

  test("kebab-case Aggregate (incident-update.created)", () => {
    expect(
      parseAutoVerb(event({ aggregateType: "incident-update", type: "incident-update.created" })),
    ).toBe("created");
  });

  test("custom verb → null", () => {
    expect(parseAutoVerb(event({ type: "user.imported" }))).toBeNull();
  });

  test("type ohne dot-separator → null", () => {
    expect(parseAutoVerb(event({ type: "userCreated" }))).toBeNull();
  });

  test("type mit verschachteltem prefix → null", () => {
    // "user.profile.updated" hat zwei dots — kein clean Auto-Verb
    expect(parseAutoVerb(event({ type: "user.profile.updated" }))).toBeNull();
  });
});
