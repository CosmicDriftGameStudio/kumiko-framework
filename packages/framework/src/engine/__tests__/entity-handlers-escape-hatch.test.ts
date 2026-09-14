import { describe, expect, test } from "bun:test";
import {
  defineEntityListHandler,
  defineEntityUpdateHandler,
  isDeprecatedCrossTenantHandler,
} from "../entity-handlers";
import { createEntity, createTextField } from "../factories";

const thingEntity = createEntity({
  table: "escape_hatch_things",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});

const sysadminAccess = { access: { roles: ["SystemAdmin"] } } as const;

describe("entity convention handlers: escapeHatch option", () => {
  test("throws when both escapeHatch and the deprecated crossTenant are set", () => {
    expect(() =>
      defineEntityUpdateHandler("thing", thingEntity, {
        ...sysadminAccess,
        escapeHatch: { reason: "operator write" },
        crossTenant: true,
      }),
    ).toThrow(/declare either escapeHatch or the deprecated crossTenant, not both/);
  });

  test("throws when escapeHatch.reason is empty", () => {
    expect(() =>
      defineEntityUpdateHandler("thing", thingEntity, {
        ...sysadminAccess,
        escapeHatch: { reason: "" },
      }),
    ).toThrow(/non-empty reason/);
  });

  test("throws when escapeHatch.reason is whitespace-only", () => {
    expect(() =>
      defineEntityListHandler("thing", thingEntity, {
        ...sysadminAccess,
        escapeHatch: { reason: "   " },
      }),
    ).toThrow(/non-empty reason/);
  });

  test("WriteHandlerDef from an escapeHatch update handler carries no escapeHatch field", () => {
    const def = defineEntityUpdateHandler("thing", thingEntity, {
      ...sysadminAccess,
      escapeHatch: { reason: "operator cross-tenant write" },
    });
    expect("escapeHatch" in def).toBe(false);
  });

  test("QueryHandlerDef from an escapeHatch list handler carries no escapeHatch field", () => {
    const def = defineEntityListHandler("thing", thingEntity, {
      ...sysadminAccess,
      escapeHatch: { reason: "operator cross-tenant list" },
    });
    expect("escapeHatch" in def).toBe(false);
  });

  test("WriteHandlerDef from a legacy crossTenant handler also carries no escapeHatch field", () => {
    const def = defineEntityUpdateHandler("thing", thingEntity, {
      ...sysadminAccess,
      crossTenant: true,
    });
    expect("escapeHatch" in def).toBe(false);
  });

  test("isDeprecatedCrossTenantHandler is true only for handlers built with crossTenant: true", () => {
    const legacyWrite = defineEntityUpdateHandler("thing", thingEntity, {
      ...sysadminAccess,
      crossTenant: true,
    });
    const escapeHatchWrite = defineEntityUpdateHandler("thing", thingEntity, {
      ...sysadminAccess,
      escapeHatch: { reason: "operator cross-tenant write" },
    });
    const plainWrite = defineEntityUpdateHandler("thing", thingEntity, sysadminAccess);
    const legacyList = defineEntityListHandler("thing", thingEntity, {
      ...sysadminAccess,
      crossTenant: true,
    });

    expect(isDeprecatedCrossTenantHandler(legacyWrite.handler)).toBe(true);
    expect(isDeprecatedCrossTenantHandler(legacyList.handler)).toBe(true);
    expect(isDeprecatedCrossTenantHandler(escapeHatchWrite.handler)).toBe(false);
    expect(isDeprecatedCrossTenantHandler(plainWrite.handler)).toBe(false);
  });
});
