// Boot-mode tests for runBootstrap — no real Postgres/Redis: the invite
// fail-fast runs before any boot step, and KUMIKO_DRY_RUN_ENV=boot exits
// before any connection. The provisioning itself is covered end to end by
// bundled-features' bootstrap.integration.test.ts.

import { describe, expect, test } from "bun:test";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { runBootstrap } from "../run-bootstrap.js";
import { makeProbeFeature, withClearedBootEnv } from "./boot-probe-fixture.js";

const probeFeature = makeProbeFeature({
  name: "bootstrap-boot-probe",
  table: "bootstrap_boot_probe",
});

// The invite flow mails through delivery, so the registry needs it.
const appFeatures = [
  createTemplateResolverFeature(),
  createRendererFoundationFeature(),
  createDeliveryFeature(),
  probeFeature,
];

const DUMMY_ENV = {
  DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:1/smoke",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "smokesmokesmokesmokesmokesmokesmokesmoke",
} as const;

const TENANT_ID = "00000000-0000-4000-8000-0000000000b1" as TenantId;

const plan = {
  tenants: [{ id: TENANT_ID, key: "acme", name: "Acme" }],
  systemAdmins: [{ email: "root@example.com", tenantId: TENANT_ID, role: "TenantAdmin" }],
};

async function captureLogs<T>(run: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    return { result: await run(), logs };
  } finally {
    console.log = originalLog;
  }
}

describe("runBootstrap boot-mode", () => {
  withClearedBootEnv();

  test("KUMIKO_DRY_RUN_ENV=boot validates the composed registry and returns no report", async () => {
    const { result, logs } = await captureLogs(() =>
      runBootstrap({
        features: appFeatures,
        migrations: false,
        allowPlaintextPii: "boot-mode test, nothing is stored",
        envSource: { ...DUMMY_ENV, KUMIKO_DRY_RUN_ENV: "boot" },
        auth: { invite: { appUrl: "https://app.example.com/invite/accept" } },
        ...plan,
      }),
    );
    expect(result).toBeUndefined();
    expect(logs.some((line) => line.includes("[runBootstrap] boot validation OK"))).toBe(true);
  });

  test("fails fast without an invite flow — bootstrap has no other way to grant access", async () => {
    await expect(
      runBootstrap({
        features: appFeatures,
        migrations: false,
        envSource: { ...DUMMY_ENV, KUMIKO_DRY_RUN_ENV: "boot" },
        auth: {},
        ...plan,
      }),
    ).rejects.toThrow("no invite flow mounted");
  });

  test("auth.mail without SMTP_HOST mounts no invite flow and fails fast as well", async () => {
    await expect(
      runBootstrap({
        features: appFeatures,
        migrations: false,
        envSource: { ...DUMMY_ENV, KUMIKO_DRY_RUN_ENV: "boot" },
        auth: { mail: { baseUrl: "https://app.example.com" } },
        ...plan,
      }),
    ).rejects.toThrow("no invite flow mounted");
  });
});
