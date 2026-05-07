import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  testTenantId,
  type TestStack,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createComplianceProfilesFeature, tenantComplianceProfileEntity } from "../feature";

const SET_PROFILE = "compliance-profiles:write:set-profile";
const FOR_TENANT = "compliance-profiles:query:for-tenant";
const LIST_PROFILES = "compliance-profiles:query:list-profiles";
const SUB_PROCESSORS = "compliance-profiles:query:sub-processors";
const NEEDS_PROFILE = "compliance-profiles:query:needs-profile";

// S1.8 N5: Isolierten Tenant-Admin pro Test bauen — verhindert
// Cross-Test-Interferenz uber gemeinsamen Default-tenantId aus
// TestUsers.admin. Eindeutige numerische ID + parallele tenantId.
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
  await createEntityTable(db, tenantComplianceProfileEntity);
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("compliance-profiles :: list-profiles", () => {
  test("liefert die 3 wählbaren Profile mit Region + Sprachen", async () => {
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

  test("minimal-no-region ist NICHT in der Liste (kein Production-Default)", async () => {
    const result = await stack.http.queryOk<{ profiles: Array<{ key: string }> }>(
      LIST_PROFILES,
      {},
      tenantAdmin,
    );
    expect(result.profiles.find((p) => p.key === "minimal-no-region")).toBeUndefined();
  });
});

describe("compliance-profiles :: for-tenant", () => {
  test("ohne Setting → minimal-no-region + warning=no-profile-selected", async () => {
    const result = await stack.http.queryOk<{
      profile: { key: string };
      warning?: string;
    }>(FOR_TENANT, {}, normalUser);
    expect(result.profile.key).toBe("minimal-no-region");
    expect(result.warning).toBe("no-profile-selected");
  });
});

describe("compliance-profiles :: set-profile", () => {
  test("TenantAdmin kann Profile auf eu-dsgvo setzen", async () => {
    await stack.http.writeOk(
      SET_PROFILE,
      { profileKey: "eu-dsgvo" },
      tenantAdmin,
    );

    const result = await stack.http.queryOk<{
      profile: { key: string; region: string; breach: { authorityContact: string } };
      warning?: string;
    }>(FOR_TENANT, {}, tenantAdmin);
    expect(result.profile.key).toBe("eu-dsgvo");
    expect(result.profile.region).toBe("EU");
    expect(result.profile.breach.authorityContact).toBe("BlnBDI Berlin");
    expect(result.warning).toBeUndefined();
  });

  test("set-profile ist idempotent — zweiter Call wechselt Profile", async () => {
    await stack.http.writeOk(
      SET_PROFILE,
      { profileKey: "eu-dsgvo" },
      tenantAdmin,
    );
    await stack.http.writeOk(
      SET_PROFILE,
      { profileKey: "swiss-dsg" },
      tenantAdmin,
    );

    const result = await stack.http.queryOk<{
      profile: { key: string; region: string; breach: { authorityContact: string } };
    }>(FOR_TENANT, {}, tenantAdmin);
    expect(result.profile.key).toBe("swiss-dsg");
    expect(result.profile.breach.authorityContact).toBe("EDÖB Bern");
  });

  test("set-profile mit Override merged auf base-profile", async () => {
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
    // Andere userRights-Felder bleiben aus eu-dsgvo
    expect(result.profile.userRights.portabilityFormat).toEqual(["json"]);
  });

  test("Member ohne TenantAdmin-Rolle bekommt 403 beim set-profile", async () => {
    const result = await stack.http.write(
      SET_PROFILE,
      { profileKey: "eu-dsgvo" },
      normalUser,
    );
    expect(result.status).toBe(403);
  });

  test("set-profile mit invalid JSON-Override wirft Error", async () => {
    const result = await stack.http.write(
      SET_PROFILE,
      { profileKey: "eu-dsgvo", override: "not-valid-json" },
      tenantAdmin,
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  test("set-profile mit Array statt Object als Override wirft Error", async () => {
    const result = await stack.http.write(
      SET_PROFILE,
      { profileKey: "eu-dsgvo", override: JSON.stringify([{ foo: 1 }]) },
      tenantAdmin,
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  // S1.7 X1: Schema engt sich auf SELECTABLE_PROFILE_KEYS
  test("set-profile mit minimal-no-region wird abgelehnt (X1)", async () => {
    const result = await stack.http.write(
      SET_PROFILE,
      { profileKey: "minimal-no-region" },
      tenantAdmin,
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  // S1.7 X2: Override mit unbekannten Top-Level-Keys
  test("set-profile mit unbekanntem Top-Level-Override-Key wirft Error (X2)", async () => {
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

  // S1.7 F2: SystemAdmin kann Profile setzen
  test("SystemAdmin kann Profile setzen (Plattform-Operator-Pfad)", async () => {
    const sysAdmin = createIsolatedTenantAdmin(50, ["SystemAdmin"]);
    const result = await stack.http.writeOk(
      SET_PROFILE,
      { profileKey: "eu-dsgvo" },
      sysAdmin,
    );
    expect(result).toMatchObject({ profileKey: "eu-dsgvo", isNew: true });
  });

  // S1.7 F3: tenantIdOverride als SystemAdmin → für Customer-Tenant
  test("SystemAdmin kann mit tenantIdOverride für anderen Tenant Profile setzen (F3)", async () => {
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
  });

  // S1.7 F3: tenantIdOverride als TenantAdmin → 403
  test("TenantAdmin mit tenantIdOverride bekommt 403 (F3)", async () => {
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
  test("liefert active + planned Sub-Processors mit Pflicht-Feldern", async () => {
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

    const cloudflare = result.active.find((s) => s.name.includes("Cloudflare"));
    expect(cloudflare?.sccRequired).toBe(true);

    expect(result.planned.length).toBeGreaterThan(0);
    expect(result.planned.every((p) => p.status === "planned")).toBe(true);

    expect(result.total).toBe(result.active.length + result.planned.length);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("compliance-profiles :: needs-profile (S1.5 — Onboarding-Banner)", () => {
  test("Tenant ohne Profile-Wahl → needsSelection=true, reason=no-profile-selected", async () => {
    // Frischer Tenant-Admin (eigener Tenant ID damit kein Profile gesetzt
    // ist — sonst sieht er den Eintrag aus den vorherigen set-profile-Tests).
    const freshTenantAdmin = createIsolatedTenantAdmin(99);
    const result = await stack.http.queryOk<{
      needsSelection: boolean;
      currentProfile: string | null;
      reason?: string;
    }>(NEEDS_PROFILE, {}, freshTenantAdmin);
    expect(result.needsSelection).toBe(true);
    expect(result.currentProfile).toBeNull();
    expect(result.reason).toBe("no-profile-selected");
  });

  test("Tenant mit eu-dsgvo-Wahl → needsSelection=false", async () => {
    const setupAdmin = createIsolatedTenantAdmin(100);
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, setupAdmin);

    const result = await stack.http.queryOk<{
      needsSelection: boolean;
      currentProfile: string | null;
    }>(NEEDS_PROFILE, {}, setupAdmin);
    expect(result.needsSelection).toBe(false);
    expect(result.currentProfile).toBe("eu-dsgvo");
  });

  // S1.8 O3: minimal-no-region-Defensiv-Pfad in needs-profile.query.ts
  // entfernt (toter Code nach S1.7 X1 — Zod blockt minimal-no-region).
  // Wenn Sprint 2 einen seedComplianceProfile-Helper bringt der den
  // Migration-Edge-Case einführt, kommt hier ein neuer Test rein.

  test("Member-Rolle bekommt 403 (Banner ist Admin-only)", async () => {
    const result = await stack.http.query(NEEDS_PROFILE, {}, normalUser);
    expect(result.status).toBe(403);
  });
});
