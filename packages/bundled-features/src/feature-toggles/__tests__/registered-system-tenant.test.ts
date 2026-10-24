// Pin the convention that registered.query uses SYSTEM_TENANT_ID
// instead of event.user.tenantId. Operator tooling must see platform-wide
// truth rather than its own tenant-scoped view. The convention is documented
// in DispatcherOptions.effectiveFeatures; this test pins it so a future
// refactor, such as mechanical sed or copy-paste, does not silently change
// it back to event.user.tenantId.
//
// A pure unit test is not possible because registered.query performs a DB
// select on globalFeatureStateTable BEFORE the effectiveFeatures call.
// We mock the ctx.db select path so the handler can complete. The convention
// pin is the test's only assertion; feature-toggles.integration.ts covers
// actual integration behaviour.

import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createDispatcher } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { createFeatureTogglesFeature } from "../feature.ts";
import type { GlobalFeatureToggleRuntime } from "../toggle-runtime.ts";

describe("Sprint 8a: registered.query SYSTEM_TENANT_ID convention", () => {
  test("ruft effectiveFeatures mit SYSTEM_TENANT_ID, nicht mit caller-tenantId", async () => {
    const observed: string[] = [];

    const dummy = defineFeature("dummy", (r) => {
      r.entity({
        name: "widget",
        ...createEntity({
          table: "Widgets",
          fields: { name: createTextField({ personal: false, reason: "technical_reference" }) },
        }),
      });
    });

    const runtime: GlobalFeatureToggleRuntime | null = null;
    const featureToggles = createFeatureTogglesFeature({
      getRuntime: () => {
        if (!runtime) throw new Error("runtime not initialized");
        return runtime;
      },
    });

    const registry = createRegistry([dummy, featureToggles]);

    // Mock ctx.db through bun-db's asRawClient surface: the handler calls
    // selectMany(ctx.db.raw, ...) → asRawClient(raw).unsafe(...). We provide
    // empty overrides so the handler passes through the DB path and then
    // calls ctx.services.effectiveFeatures, which is observable here.
    const mockDb = {
      unsafe: async () => [] as unknown[],
      begin: async () => undefined,
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

    // Pin: registered.query causes at least two effectiveFeatures calls:
    //   1. dispatcher's checkFeatureEnabled (with user.tenantId = callerTenant)
    //   2. registered.query handler body (with SYSTEM_TENANT_ID)
    // If a future refactor changes SYSTEM_TENANT_ID back to event.user.tenantId,
    // the second call is missing and this test fails.
    expect(observed).toContain(callerTenant);
    expect(observed).toContain(SYSTEM_TENANT_ID);
  });
});
