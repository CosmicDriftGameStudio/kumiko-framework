import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createComplianceProfilesFeature, tenantComplianceProfileEntity } from "../feature";

const SET_PROFILE = "compliance-profiles:write:set-profile";
const FOR_TENANT = "compliance-profiles:query:for-tenant";
const LIST_PROFILES = "compliance-profiles:query:list-profiles";

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
});
