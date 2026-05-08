// Sprint 8a recipe-test pin: registered.query nutzt SYSTEM_TENANT_ID
// statt event.user.tenantId. Operator-tooling muss PLATTFORM-truth
// sehen, nicht den eigenen tier-cut. Convention ist in DispatcherOptions.
// effectiveFeatures dokumentiert; dieser test pinst sie damit ein
// future-refactor (z.B. mechanisches sed oder copy-paste) sie nicht
// silent zurückdreht zu event.user.tenantId.
//
// Pure unit-test ist nicht möglich weil registered.query einen DB-select
// auf globalFeatureStateTable macht BEVOR der effectiveFeatures-call
// läuft. Wir mocken den ctx.db.select-pfad damit der handler komplett
// durchläuft. Die Convention-Pin ist die einzige Aussage des tests —
// echtes integration-Verhalten deckt feature-toggles.integration.ts ab.

import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createDispatcher } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser } from "@cosmicdrift/kumiko-framework/stack";
import { describe, expect, test } from "vitest";
import { createFeatureTogglesFeature } from "../feature";
import { GlobalFeatureToggleRuntime } from "../toggle-runtime";

describe("Sprint 8a: registered.query SYSTEM_TENANT_ID convention", () => {
  test("ruft effectiveFeatures mit SYSTEM_TENANT_ID, nicht mit caller-tenantId", async () => {
    const observed: string[] = [];

    const dummy = defineFeature("dummy", (r) => {
      r.entity("widget", createEntity({ table: "Widgets", fields: { name: createTextField() } }));
    });

    let runtime: GlobalFeatureToggleRuntime | null = null;
    const featureToggles = createFeatureTogglesFeature({
      getRuntime: () => {
        if (!runtime) throw new Error("runtime not initialized");
        return runtime;
      },
    });

    const registry = createRegistry([dummy, featureToggles]);

    // Mock ctx.db.select-chain damit der handler durch den DB-Pfad
    // kommt. Wir liefern leere overrides (.from() returnt []), das
    // genügt — registered.query iteriert dann über registry.features
    // und ruft ctx.effectiveFeatures, was unser observable ist.
    const mockDb = {
      select: () => ({ from: async () => [] as unknown[] }),
    } as unknown as Parameters<typeof createDispatcher>[1]["db"];

    const callerTenant = "00000000-0000-4000-8000-0000000000c1" as TenantId;

    const dispatcher = createDispatcher(
      registry,
      { db: mockDb },
      {
        effectiveFeatures: (tenantId) => {
          observed.push(tenantId);
          return new Set(["dummy", "feature-toggles"]);
        },
      },
    );

    const admin = createTestUser({
      id: "admin-1",
      tenantId: callerTenant,
      roles: ["SystemAdmin"],
    });

    await dispatcher.query("feature-toggles:query:registered", {}, admin);

    // Pin: registered.query call führt zu MINDESTENS zwei effectiveFeatures-
    // calls:
    //   1. dispatcher's checkFeatureEnabled (mit user.tenantId = callerTenant)
    //   2. registered.query handler-body (mit SYSTEM_TENANT_ID)
    // Wenn ein future-refactor SYSTEM_TENANT_ID zu event.user.tenantId zurück-
    // dreht, fehlt der zweite call und dieser test fail't.
    expect(observed).toContain(callerTenant);
    expect(observed).toContain(SYSTEM_TENANT_ID);
  });
});
