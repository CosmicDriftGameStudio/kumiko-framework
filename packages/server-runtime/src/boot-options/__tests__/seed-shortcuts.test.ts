import { describe, expect, test } from "bun:test";
import { resolveSeedShortcuts } from "../seed-shortcuts.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000310";
const ENV = {
  DEMO_TENANT_ID: TENANT_ID,
  DEMO_ADMIN_EMAIL: "admin@demo.example",
  DEMO_ADMIN_PASSWORD: "admin-password-1234",
  DEMO_SYSADMIN_EMAIL: "sys@demo.example",
  DEMO_SYSADMIN_PASSWORD: "sys-password-12345",
};
const withAuth = { hasAuth: true, hasAuthAdmin: false };

describe("resolveSeedShortcuts", () => {
  test("needs auth", () => {
    expect(() =>
      resolveSeedShortcuts(
        { sysadminFromEnv: true },
        { envSource: ENV, hasAuth: false, hasAuthAdmin: false },
      ),
    ).toThrow(/need `auth`/);
  });

  test("demoAdminFromEnv next to auth.admin is refused", () => {
    expect(() =>
      resolveSeedShortcuts(
        { demoTenant: { key: "demo", name: "Demo" }, demoAdminFromEnv: true },
        { envSource: ENV, hasAuth: true, hasAuthAdmin: true },
      ),
    ).toThrow(/keep one/);
  });

  test("demoTenant without an id or DEMO_TENANT_ID is refused", () => {
    expect(() =>
      resolveSeedShortcuts(
        { demoTenant: { key: "demo", name: "Demo" } },
        { ...withAuth, envSource: {} },
      ),
    ).toThrow(/UUID id/);
  });

  test("missing account env vars are named", () => {
    expect(() =>
      resolveSeedShortcuts(
        { demoTenant: { key: "demo", name: "Demo" }, sysadminFromEnv: true },
        { ...withAuth, envSource: { DEMO_TENANT_ID: TENANT_ID, DEMO_SYSADMIN_EMAIL: "s@x" } },
      ),
    ).toThrow(/DEMO_SYSADMIN_PASSWORD/);
  });

  test("demoAdminFromEnv needs demoTenant", () => {
    expect(() =>
      resolveSeedShortcuts({ demoAdminFromEnv: true }, { ...withAuth, envSource: ENV }),
    ).toThrow(/needs seeds.demoTenant/);
  });

  test("tenant, admin and sysadmin yield one seed each", () => {
    const seeds = resolveSeedShortcuts(
      {
        demoTenant: { key: "demo", name: "Demo" },
        demoAdminFromEnv: true,
        sysadminFromEnv: true,
      },
      { ...withAuth, envSource: ENV },
    );
    expect(seeds).toHaveLength(3);
  });
});
