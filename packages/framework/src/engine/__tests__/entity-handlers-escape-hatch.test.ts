import { describe, expect, test } from "bun:test";
import {
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
} from "../entity-handlers.js";
import { CODEMOD_PLACEHOLDER_REASON_MARKER } from "../escape-hatch-reason.js";
import { createEntity, createTextField } from "../factories.js";

const thingEntity = createEntity({
  table: "escape_hatch_things",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});

const sysadminAccess = { access: { roles: ["SystemAdmin"] } } as const;

describe("entity convention handlers: escapeHatch option", () => {
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

  test("a write handler with escapeHatch and non-SystemAdmin roles throws at definition", () => {
    expect(() =>
      defineEntityUpdateHandler("thing", thingEntity, {
        access: { roles: ["Admin"] },
        escapeHatch: { reason: "operator cross-tenant write" },
      }),
    ).toThrow(/SystemAdmin-only/);
    expect(() =>
      defineEntityUpdateHandler("thing", thingEntity, {
        access: { roles: ["SystemAdmin", "Admin"] },
        escapeHatch: { reason: "operator cross-tenant write" },
      }),
    ).toThrow(/SystemAdmin-only/);
  });

  test("a write handler with escapeHatch and openToAll access throws at definition", () => {
    expect(() =>
      defineEntityUpdateHandler("thing", thingEntity, {
        access: { openToAll: { reason: "any signed-in user" } },
        escapeHatch: { reason: "operator cross-tenant write" },
      }),
    ).toThrow(/SystemAdmin-only/);
  });

  test("the SystemAdmin-only rule covers every write verb factory", () => {
    const options = {
      access: { roles: ["Admin"] },
      escapeHatch: { reason: "operator cross-tenant write" },
    } as const;
    for (const define of [
      defineEntityCreateHandler,
      defineEntityUpdateHandler,
      defineEntityDeleteHandler,
    ]) {
      expect(() => define("thing", thingEntity, options)).toThrow(/SystemAdmin-only/);
    }
  });

  test("a write handler with escapeHatch and SystemAdmin-only roles is accepted", () => {
    expect(() =>
      defineEntityUpdateHandler("thing", thingEntity, {
        access: { roles: ["SystemAdmin"] },
        escapeHatch: { reason: "operator cross-tenant write" },
      }),
    ).not.toThrow();
  });

  test("a list handler with escapeHatch keeps non-SystemAdmin access", () => {
    expect(() =>
      defineEntityListHandler("thing", thingEntity, {
        access: { roles: ["Admin"] },
        escapeHatch: { reason: "tenant admin cross-tenant list" },
      }),
    ).not.toThrow();
  });

  test("an escapeHatch reason still carrying the codemod placeholder is rejected", () => {
    const unedited = `thing:update writes thing rows across every tenant (migrated from crossTenant: true; ${CODEMOD_PLACEHOLDER_REASON_MARKER})`;
    expect(() =>
      defineEntityUpdateHandler("thing", thingEntity, {
        ...sysadminAccess,
        escapeHatch: { reason: unedited },
      }),
    ).toThrow(/replace the codemod placeholder/);
    expect(() =>
      defineEntityListHandler("thing", thingEntity, {
        ...sysadminAccess,
        escapeHatch: { reason: unedited },
      }),
    ).toThrow(/replace the codemod placeholder/);
  });
});
