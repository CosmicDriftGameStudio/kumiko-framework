import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  getActiveSubProcessors,
  getPlannedSubProcessors,
} from "@cosmicdrift/kumiko-framework/compliance";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { access } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature, tenantComplianceProfileEntity } from "../feature.ts";

const SET_PROFILE = "compliance-profiles:write:set-profile";
const FOR_TENANT = "compliance-profiles:query:for-tenant";
const LIST_PROFILES = "compliance-profiles:query:list-profiles";
const SUB_PROCESSORS = "compliance-profiles:query:sub-processors";
const NEEDS_PROFILE = "compliance-profiles:query:needs-profile";

// Build an isolated tenant admin for each test to prevent
// cross-test interference from the shared default tenantId in
// TestUsers.admin. Use a unique numeric ID and matching tenantId.
function createIsolatedTenantAdmin(n: number, roles: string[] = ["TenantAdmin"]) {
  return createTestUser({ id: n, tenantId: testTenantId(n), roles });
}

let stack: TestStack;
let db: DbConnection;

const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"] });
const normalUser = createTestUser({ id: 3, roles: ["Member"] });

const feature = createComplianceProfilesFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("compliance-profiles :: list-profiles", () => {
  test("returns the 3 selectable profiles with region + languages", async () => {
    const result = await stack.http.queryOk<{
      profiles: Array<{ key: string; region: string; languages: string[] }>;
    }>(LIST_PROFILES, {}, tenantAdmin);
    expect(result.profiles).toHaveLength(3);
    const keys = result.profiles.map((p) => p.key);
    expect(keys).toEqual(["eu-dsgvo", "swiss-dsg", "de-hr-dsgvo-hgb"]);
    const swiss = result.profiles.find((p) => p.key === "swiss-dsg");
    expect(swiss?.region).toBe("CH");
    expect(swiss?.languages).toContain("fr");
  });

  test("minimal-no-region is NOT in the list (no Production default)", async () => {
    const result = await stack.http.queryOk<{ profiles: Array<{ key: string }> }>(
      LIST_PROFILES,
      {},
      tenantAdmin,
    );
    expect(result.profiles.find((p) => p.key === "minimal-no-region")).toBeUndefined();
  });
});

describe("compliance-profiles :: for-tenant", () => {
  test("without a setting → minimal-no-region + warning=no-profile-selected", async () => {
    const result = await stack.http.queryOk<{
      profile: { key: string };
      warning?: string;
    }>(FOR_TENANT, {}, normalUser);
    expect(result.profile.key).toBe("minimal-no-region");
    expect(result.warning).toBe("no-profile-selected");
  });
});

describe("compliance-profiles :: set-profile", () => {
  test("TenantAdmin can set profiles to eu-dsgvo", async () => {
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantAdmin);

    const result = await stack.http.queryOk<{
      profile: { key: string; region: string; breach: { authorityContact: string } };
      warning?: string;
    }>(FOR_TENANT, {}, tenantAdmin);
    expect(result.profile.key).toBe("eu-dsgvo");
    expect(result.profile.region).toBe("EU");
    expect(result.profile.breach.authorityContact).toBe("BlnBDI Berlin");
    expect(result.warning).toBeUndefined();
  });

  test("set-profile is idempotent — second call switches profiles", async () => {
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantAdmin);
    await stack.http.writeOk(SET_PROFILE, { profileKey: "swiss-dsg" }, tenantAdmin);

    const result = await stack.http.queryOk<{
      profile: { key: string; region: string; breach: { authorityContact: string } };
    }>(FOR_TENANT, {}, tenantAdmin);
    expect(result.profile.key).toBe("swiss-dsg");
    expect(result.profile.breach.authorityContact).toBe("EDÖB Bern");
  });

  test("set-profile with override merges onto base-profile", async () => {
    await stack.http.writeOk(
      SET_PROFILE,
      {
        profileKey: "eu-dsgvo",
        override: JSON.stringify({
          userRights: { gracePeriod: { days: 60 } },
        }),
      },
      tenantAdmin,
    );

    const result = await stack.http.queryOk<{
      profile: { userRights: { gracePeriod: { days: number }; portabilityFormat: string[] } };
    }>(FOR_TENANT, {}, tenantAdmin);
    expect(result.profile.userRights.gracePeriod).toEqual({ days: 60 });
    // Other userRights fields are preserved from eu-dsgvo
    expect(result.profile.userRights.portabilityFormat).toEqual(["json"]);
  });

  test("Member without TenantAdmin role gets 403 on set-profile", async () => {
    const result = await stack.http.write(SET_PROFILE, { profileKey: "eu-dsgvo" }, normalUser);
    expect(result.status).toBe(403);
  });

  test("set-profile with invalid JSON override throws Error", async () => {
    const result = await stack.http.write(
      SET_PROFILE,
      { profileKey: "eu-dsgvo", override: "not-valid-json" },
      tenantAdmin,
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  test("set-profile with array instead of object as override throws Error", async () => {
    const result = await stack.http.write(
      SET_PROFILE,
      { profileKey: "eu-dsgvo", override: JSON.stringify([{ foo: 1 }]) },
      tenantAdmin,
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  // The schema restricts values to SELECTABLE_PROFILE_KEYS
  test("set-profile with minimal-no-region is rejected", async () => {
    const result = await stack.http.write(
      SET_PROFILE,
      { profileKey: "minimal-no-region" },
      tenantAdmin,
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  // Reject overrides with unknown top-level keys
  test("set-profile with unknown top-level override key throws Error", async () => {
    const result = await stack.http.write(
      SET_PROFILE,
      {
        profileKey: "eu-dsgvo",
        override: JSON.stringify({ userrights: { gracePeriod: { days: 60 } } }), // typo lowercase
      },
      tenantAdmin,
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  // Sub-level typos are checked with a path-specific assertion via
  // ValidationError.details.fields.
  test("set-profile with a sub-level typo returns validation_error with Path", async () => {
    const err = await stack.http.writeErr(
      SET_PROFILE,
      {
        profileKey: "eu-dsgvo",
        override: JSON.stringify({ userRights: { weeks: 3 } }), // weeks does not exist
      },
      tenantAdmin,
    );
    expect(err.code).toBe("validation_error");
    expect(err.httpStatus).toBe(400);
    const fields = (err.details as { fields: Array<{ path: string }> })?.fields;
    expect(fields).toBeDefined();
    // Schema strictness reports either "userRights.weeks" as unrecognized_keys
    // or the general "userRights" path, depending on how Zod reports it. Both
    // paths cover the bug.
    expect(fields?.some((f) => f.path.includes("userRights"))).toBe(true);
  });

  test("set-profile with invalid retention shape returns validation_error with Path", async () => {
    const err = await stack.http.writeErr(
      SET_PROFILE,
      {
        profileKey: "eu-dsgvo",
        override: JSON.stringify({
          userRights: { gracePeriod: { days: 30, hours: 24 } }, // strict-disjunction
        }),
      },
      tenantAdmin,
    );
    expect(err.code).toBe("validation_error");
    const fields = (err.details as { fields: Array<{ path: string }> })?.fields;
    expect(fields?.some((f) => f.path.includes("gracePeriod"))).toBe(true);
  });

  // SystemAdmin can set profiles
  test("SystemAdmin can set profiles (platform operator path)", async () => {
    const sysAdmin = createIsolatedTenantAdmin(50, ["SystemAdmin"]);
    const result = await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, sysAdmin);
    expect(result).toMatchObject({ profileKey: "eu-dsgvo", isNew: true });
  });

  // SystemAdmin can set profiles for a customer tenant via tenantIdOverride
  test("SystemAdmin can set profiles for another tenant with tenantIdOverride", async () => {
    const sysAdmin = createIsolatedTenantAdmin(51, ["SystemAdmin"]);
    const targetTenantAdmin = createIsolatedTenantAdmin(52);

    await stack.http.writeOk(
      SET_PROFILE,
      { profileKey: "swiss-dsg", tenantIdOverride: targetTenantAdmin.tenantId },
      sysAdmin,
    );

    const result = await stack.http.queryOk<{ profile: { key: string; region: string } }>(
      FOR_TENANT,
      {},
      targetTenantAdmin,
    );
    expect(result.profile.key).toBe("swiss-dsg");
    expect(result.profile.region).toBe("CH");

    const events = await selectMany<{ tenantId: string; createdBy: string }>(
      stack.db,
      eventsTable,
      { tenantId: targetTenantAdmin.tenantId },
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.createdBy === sysAdmin.id)).toBe(true);
  });

  // tenantIdOverride as TenantAdmin → 403
  test("TenantAdmin with tenantIdOverride gets 403", async () => {
    const someTenantAdmin = createIsolatedTenantAdmin(53);
    const result = await stack.http.write(
      SET_PROFILE,
      { profileKey: "eu-dsgvo", tenantIdOverride: testTenantId(54) },
      someTenantAdmin,
    );
    expect(result.status).toBe(403);
  });
});

describe("compliance-profiles :: sub-processors (S1.4)", () => {
  test("returns active + planned Sub-Processors with required fields", async () => {
    const result = await stack.http.queryOk<{
      active: Array<{ name: string; region: string; dpa: string; sccRequired?: boolean }>;
      planned: Array<{ name: string; status: string }>;
      total: number;
      generatedAt: string;
    }>(SUB_PROCESSORS, {}, normalUser);

    expect(result.active.length).toBeGreaterThan(0);
    const hetzner = result.active.find((s) => s.name.includes("Hetzner"));
    expect(hetzner).toBeDefined();
    expect(hetzner?.dpa).toMatch(/^https:\/\//);
    expect(hetzner?.region).toContain("Germany");

    const stripe = result.active.find((s) => s.name.includes("Stripe"));
    expect(stripe?.sccRequired).toBe(true);

    expect(result.planned.map((p) => p.name)).toEqual(
      getPlannedSubProcessors().map((sp) => sp.name),
    );
    expect(result.active.map((a) => a.name)).toEqual(getActiveSubProcessors().map((sp) => sp.name));

    expect(result.total).toBe(result.active.length + result.planned.length);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("compliance-profiles :: needs-profile (S1.5 — Onboarding-Banner)", () => {
  test("Tenant without profile selection → needsSelection=true, reason=no_profile_selected", async () => {
    // Use a fresh tenant so no profile has been selected; otherwise this test
    // would see the entry created by the preceding set-profile tests.
    const freshTenantAdmin = createIsolatedTenantAdmin(99);
    const result = await stack.http.queryOk<{
      needsSelection: boolean;
      currentProfile: string | null;
      reason?: string;
    }>(NEEDS_PROFILE, {}, freshTenantAdmin);
    expect(result.needsSelection).toBe(true);
    expect(result.currentProfile).toBeNull();
    expect(result.reason).toBe("no_profile_selected");
  });

  test("Tenant with eu-dsgvo selection → needsSelection=false", async () => {
    const setupAdmin = createIsolatedTenantAdmin(100);
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, setupAdmin);

    const result = await stack.http.queryOk<{
      needsSelection: boolean;
      currentProfile: string | null;
    }>(NEEDS_PROFILE, {}, setupAdmin);
    expect(result.needsSelection).toBe(false);
    expect(result.currentProfile).toBe("eu-dsgvo");
  });

  // The minimal-no-region defensive path was removed from
  // needs-profile.query.ts because Zod blocks minimal-no-region.
  // If a seedComplianceProfile helper introduces a migration edge case,
  // add a new test here.

  test("Member role gets 403 (banner is admin-only)", async () => {
    const result = await stack.http.query(NEEDS_PROFILE, {}, normalUser);
    expect(result.status).toBe(403);
  });
});

describe("compliance-profiles :: needs-profile with access.systemAdmin narrowing", () => {
  let narrowedStack: TestStack;
  let narrowedDb: DbConnection;

  beforeAll(async () => {
    const narrowedFeature = createComplianceProfilesFeature({ access: access.systemAdmin });
    narrowedStack = await setupTestStack({ features: [narrowedFeature] });
    narrowedDb = narrowedStack.db;
    await unsafeCreateEntityTable(narrowedDb, tenantComplianceProfileEntity);
  });

  afterAll(async () => {
    await narrowedStack.cleanup();
  });

  // TenantAdmin can no longer reach the picker screen (access.systemAdmin
  // excludes TenantAdmin) — needsSelection must stop pointing them at a
  // screen they can't open.
  test("TenantAdmin without picker access → needsSelection remains false, reason=picker_not_accessible_for_role", async () => {
    const excludedTenantAdmin = createIsolatedTenantAdmin(200);
    const result = await narrowedStack.http.queryOk<{
      needsSelection: boolean;
      currentProfile: string | null;
      reason?: string;
    }>(NEEDS_PROFILE, {}, excludedTenantAdmin);
    expect(result.needsSelection).toBe(false);
    expect(result.currentProfile).toBeNull();
    expect(result.reason).toBe("picker_not_accessible_for_role");
  });

  // A user holding both roles can still reach the picker via SystemAdmin —
  // the gate must intersect the caller's actual roles, not just check
  // whether TenantAdmin (the query's fixed call-access role) is among the
  // feature's configured picker roles.
  test("TenantAdmin+SystemAdmin dual role → needsSelection remains true (picker accessible via SystemAdmin)", async () => {
    const dualRoleUser = createTestUser({
      id: 204,
      tenantId: testTenantId(204),
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const result = await narrowedStack.http.queryOk<{
      needsSelection: boolean;
      currentProfile: string | null;
      reason?: string;
    }>(NEEDS_PROFILE, {}, dualRoleUser);
    expect(result.needsSelection).toBe(true);
    expect(result.reason).toBe("no_profile_selected");
  });

  // The needs-profile call access itself stays TenantAdmin-only — the
  // `access` option is not passed 1:1 to the query dispatcher (otherwise
  // SystemAdmin could now call an endpoint only TenantAdmin used to be
  // allowed to call — widening access is not requested).
  test("SystemAdmin still may not call needs-profile (call access unchanged)", async () => {
    const systemAdmin = createTestUser({
      id: 201,
      tenantId: testTenantId(201),
      roles: ["SystemAdmin"],
    });
    const result = await narrowedStack.http.query(NEEDS_PROFILE, {}, systemAdmin);
    expect(result.status).toBe(403);
  });

  test("TenantAdmin with an already selected profile → needsSelection remains false, no special reason case", async () => {
    const setupAdmin = createIsolatedTenantAdmin(202);
    // set-profile is also narrowed to access.systemAdmin — set up via
    // SystemAdmin to create the profile row for the read test.
    const systemAdminSetup = createTestUser({
      id: 203,
      tenantId: setupAdmin.tenantId,
      roles: ["SystemAdmin"],
    });
    await narrowedStack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, systemAdminSetup);

    const result = await narrowedStack.http.queryOk<{
      needsSelection: boolean;
      currentProfile: string | null;
      reason?: string;
    }>(NEEDS_PROFILE, {}, setupAdmin);
    expect(result.needsSelection).toBe(false);
    expect(result.currentProfile).toBe("eu-dsgvo");
    expect(result.reason).toBeUndefined();
  });
});
