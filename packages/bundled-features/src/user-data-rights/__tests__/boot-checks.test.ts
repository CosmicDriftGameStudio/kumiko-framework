import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  defineFeature,
  EXT_TENANT_DATA,
  EXT_USER_DATA,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFilesFeature } from "@cosmicdrift/kumiko-framework/files";
import { EXT_SESSION_STORE } from "../../auth-foundation";
import { createComplianceProfilesFeature } from "../../compliance-profiles/feature";
import { createConfigFeature } from "../../config/feature";
import { createDataRetentionFeature } from "../../data-retention/feature";
import { createSessionsFeature } from "../../sessions/feature";
import { createTenantFeature } from "../../tenant/feature";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/feature";
import { createUserFeature } from "../../user/feature";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/feature";
import { createUserDataRightsFeature } from "../feature";

// GDPR-storage guards V2 (export-without-erase) and V3 (pii-entity-without-
// hook) moved off the framework-internal boot-validator onto user-data-
// rights' own `r.bootCheck()` (#1314); V4 (tenantOwned-entity-without-hook)
// onto tenant-lifecycle's own `r.bootCheck()` — tenant-lifecycle owns
// EXT_TENANT_DATA, so its own mount preserves the original guard's trigger
// exactly (gating on a sibling feature would silently narrow coverage).
// Unlike the old direct-function tests, these only run inside a real
// validateBoot() pass — exercising the actual `r.bootCheck()` plumbing, not
// just the guard logic.
// Stub instead of the real auth-foundation — these boot-checks are about
// GDPR-storage guards, not auth; only sessions' sessionStore registration
// needs an owner present.
const sessionStoreOwnerStub = defineFeature("auth-foundation", (r) => {
  r.extendsRegistrar(EXT_SESSION_STORE, {});
});

function baseFeatures() {
  return [
    createConfigFeature(),
    createUserFeature(),
    sessionStoreOwnerStub,
    createSessionsFeature(),
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    createFilesFeature(),
    createUserDataRightsFeature(),
    createUserDataRightsDefaultsFeature(),
  ];
}

// Minimal tenant-lifecycle assembly with NO user-data-rights* mounted at all
// — proves V4 fires from tenant-lifecycle's own mount, not from a sibling
// feature accidentally re-gating it.
function minimalTenantLifecycleFeatures() {
  return [
    createConfigFeature(),
    createTenantFeature(),
    createComplianceProfilesFeature(),
    createTenantLifecycleFeature(),
  ];
}

describe("GDPR-storage boot guards V2-V4 (via r.bootCheck)", () => {
  test("known-good assembly boot-validates (baseline)", () => {
    expect(() => validateBoot(baseFeatures())).not.toThrow();
  });

  test("V2: export hook without delete hook → Art.17 throw", () => {
    const bad = defineFeature("bad-export", (r) => {
      r.requires("user-data-rights");
      r.useExtension(EXT_USER_DATA, "badEntity", { export: async () => null });
    });
    expect(() => validateBoot([...baseFeatures(), bad])).toThrow(/Art\.17/);
  });

  test("V3: pii entity without any EXT_USER_DATA hook → throws the guard's own message", () => {
    const bad = defineFeature("crm", (r) => {
      r.entity("contact", createEntity({ fields: { email: createTextField({ pii: true }) } }));
    });
    expect(() => validateBoot([...baseFeatures(), bad])).toThrow(/EXT_USER_DATA hook.*Art\.17 gap/);
  });

  test("V4: tenantOwned entity without EXT_TENANT_DATA hook, tenant-lifecycle mounted → throws the guard's own message", () => {
    const bad = defineFeature("billing", (r) => {
      r.entity(
        "subscription",
        createEntity({ fields: { providerCustomerId: createTextField({ tenantOwned: true }) } }),
      );
    });
    expect(() => validateBoot([...minimalTenantLifecycleFeatures(), bad])).toThrow(
      /EXT_TENANT_DATA destroy hook/,
    );
  });

  test("V4: fires with no user-data-rights* mounted at all — trigger is tenant-lifecycle's own mount", () => {
    const bad = defineFeature("billing", (r) => {
      r.entity(
        "subscription",
        createEntity({ fields: { providerCustomerId: createTextField({ tenantOwned: true }) } }),
      );
    });
    const features = minimalTenantLifecycleFeatures().concat(bad);
    expect(features.some((f) => f.name.startsWith("user-data-rights"))).toBe(false);
    expect(() => validateBoot(features)).toThrow(/EXT_TENANT_DATA destroy hook/);
  });

  test("V4: tenant-lifecycle not mounted → tenantOwned entity does not throw", () => {
    const notMounted = defineFeature("billing-standalone", (r) => {
      r.entity(
        "subscription",
        createEntity({ fields: { providerCustomerId: createTextField({ tenantOwned: true }) } }),
      );
    });
    expect(() => validateBoot([...baseFeatures(), notMounted])).not.toThrow();
  });

  test("V4: tenantOwned entity WITH EXT_TENANT_DATA hook registered → no throw", () => {
    const hooked = defineFeature("billing-hooked", (r) => {
      r.requires("tenant-lifecycle");
      r.entity(
        "subscription",
        createEntity({ fields: { providerCustomerId: createTextField({ tenantOwned: true }) } }),
      );
      r.useExtension(EXT_TENANT_DATA, "subscription", { destroy: async () => {} });
    });
    expect(() => validateBoot([...minimalTenantLifecycleFeatures(), hooked])).not.toThrow();
  });
});
