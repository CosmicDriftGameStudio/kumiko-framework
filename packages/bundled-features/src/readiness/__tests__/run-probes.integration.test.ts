// The system check end to end: the write starts a run, the worker job fills it after commit, and
// the queries show each caller only the rows they may see.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { defineFeature, ProbeFailure } from "@cosmicdrift/kumiko-framework/engine";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { ProbeTextKeys, ReadinessQueries, ReadinessWrites } from "../constants.ts";
import { createReadinessFeature } from "../feature.ts";

const SECRET_IN_ERROR = "super-secret-smtp-password";

let paidRuns = 0;
const okVerdict = { status: "ok", message: { key: "fixture.ok" } } as const;

const fixtureFeature = defineFeature("probe-fixture", (r) => {
  r.requires({ features: ["readiness"] });
  r.translations({
    keys: {
      "fixture.area": { en: "Fixture" },
      "fixture.label": { en: "Fixture check" },
      "fixture.ok": { en: "fine" },
      "fixture.fail": { en: "broken" },
    },
  });
  const common = { area: "fixture.area", label: "fixture.label" } as const;
  r.probe({
    ...common,
    name: "free-tenant",
    scope: "tenant",
    cost: "free",
    run: async () => okVerdict,
  });
  r.probe({
    ...common,
    name: "free-system",
    scope: "system",
    cost: "free",
    run: async () => okVerdict,
  });
  r.probe({
    ...common,
    name: "paid-tenant",
    scope: "tenant",
    cost: "paid",
    run: async () => {
      paidRuns += 1;
      return okVerdict;
    },
  });
  r.probe({
    ...common,
    name: "hanging",
    scope: "tenant",
    cost: "free",
    timeoutMs: 50,
    run: () => new Promise(() => undefined),
  });
  r.probe({
    ...common,
    name: "throwing",
    scope: "tenant",
    cost: "free",
    run: async () => {
      throw new Error(`login failed with ${SECRET_IN_ERROR}`);
    },
  });
  r.probe({
    ...common,
    name: "explained",
    scope: "tenant",
    cost: "free",
    run: async () => {
      throw new ProbeFailure({ key: "fixture.fail" });
    },
  });
});

type Row = {
  id: string;
  probe: string;
  status: "ok" | "failed" | "skipped";
  message: { i18nKey: string; i18nParams?: Record<string, string | number> };
};
type Latest = { rows: Row[] };

let stack: TestStack;
let nextTenant = 700;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      createReadinessFeature(),
      fixtureFeature,
    ],
    jobs: { consumerLane: "worker" },
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
    }),
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenant_secrets: tenantSecretsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

function usersOfFreshTenant() {
  nextTenant += 1;
  const tenantId = testTenantId(nextTenant);
  return {
    tenantAdmin: createTestUser({ id: nextTenant, tenantId, roles: ["TenantAdmin"] }),
    systemAdmin: createTestUser({ id: nextTenant + 1000, tenantId, roles: ["SystemAdmin"] }),
  };
}

async function runChecks(user: ReturnType<typeof createTestUser>, includePaid = false) {
  const started = await stack.http.writeOk<{ runId: string; isExisting: boolean }>(
    ReadinessWrites.runProbes,
    { includePaid },
    user,
  );
  await stack.drainJobs();
  return started;
}

const latest = (user: ReturnType<typeof createTestUser>) =>
  stack.http.queryOk<Latest>(ReadinessQueries.latestResults, {}, user);
const byProbe = (rows: Row[], name: string) =>
  rows.find((row) => row.probe === `probe-fixture:probe:${name}`);

describe("readiness run-probes", () => {
  test("a TenantAdmin run shows tenant probes only; paid is skipped and never called", async () => {
    const { tenantAdmin } = usersOfFreshTenant();
    paidRuns = 0;

    await runChecks(tenantAdmin);
    const { rows } = await latest(tenantAdmin);

    expect(byProbe(rows, "free-tenant")?.status).toBe("ok");
    expect(byProbe(rows, "free-system")).toBeUndefined();
    expect(rows.some((row) => row.probe === "readiness:probe:database")).toBe(false);
    expect(byProbe(rows, "paid-tenant")?.status).toBe("skipped");
    expect(byProbe(rows, "paid-tenant")?.message.i18nKey).toBe(ProbeTextKeys.paidNotRequested);
    expect(paidRuns).toBe(0);
  });

  test("includePaid runs the paid probe", async () => {
    const { tenantAdmin } = usersOfFreshTenant();
    paidRuns = 0;

    await runChecks(tenantAdmin, true);

    expect(byProbe((await latest(tenantAdmin)).rows, "paid-tenant")?.status).toBe("ok");
    expect(paidRuns).toBe(1);
  });

  test("a hanging probe times out while the others finish", async () => {
    const { tenantAdmin } = usersOfFreshTenant();

    await runChecks(tenantAdmin);
    const { rows } = await latest(tenantAdmin);

    expect(byProbe(rows, "hanging")?.status).toBe("failed");
    expect(byProbe(rows, "hanging")?.message.i18nKey).toBe(ProbeTextKeys.timeout);
    expect(byProbe(rows, "free-tenant")?.status).toBe("ok");
  });

  test("a thrown error stores the generic text, a ProbeFailure keeps its own", async () => {
    const { tenantAdmin } = usersOfFreshTenant();

    await runChecks(tenantAdmin);
    const { rows } = await latest(tenantAdmin);

    expect(byProbe(rows, "throwing")?.message.i18nKey).toBe(ProbeTextKeys.failed);
    expect(JSON.stringify(rows)).not.toContain(SECRET_IN_ERROR);
    expect(byProbe(rows, "explained")?.message.i18nKey).toBe("fixture.fail");
  });

  test("a SystemAdmin run includes system probes and the built-ins; the TenantAdmin still sees none", async () => {
    const { tenantAdmin, systemAdmin } = usersOfFreshTenant();

    await runChecks(systemAdmin);

    const system = await latest(systemAdmin);
    expect(byProbe(system.rows, "free-system")?.status).toBe("ok");
    expect(system.rows.find((row) => row.probe === "readiness:probe:database")?.status).toBe("ok");
    const tenantView = await latest(tenantAdmin);
    expect(byProbe(tenantView.rows, "free-system")).toBeUndefined();
    expect(tenantView.rows.some((row) => row.probe.startsWith("readiness:probe:"))).toBe(false);
  });

  test("a second click during an active run returns the same run", async () => {
    const { tenantAdmin } = usersOfFreshTenant();

    const first = await stack.http.writeOk<{ runId: string; isExisting: boolean }>(
      ReadinessWrites.runProbes,
      {},
      tenantAdmin,
    );
    const second = await stack.http.writeOk<{ runId: string; isExisting: boolean }>(
      ReadinessWrites.runProbes,
      {},
      tenantAdmin,
    );
    await stack.drainJobs();

    expect(first.isExisting).toBe(false);
    expect(second).toEqual({ runId: first.runId, isExisting: true });
    expect((await latest(tenantAdmin)).rows.length).toBeGreaterThan(0);
  });

  test("a finished run no longer blocks a new one", async () => {
    const { tenantAdmin } = usersOfFreshTenant();

    const first = await runChecks(tenantAdmin);
    const second = await runChecks(tenantAdmin);

    expect(second.isExisting).toBe(false);
    expect(second.runId).not.toBe(first.runId);
  });

  test("Member is denied", async () => {
    const member = createTestUser({ id: 9001, tenantId: testTenantId(9001), roles: ["Member"] });
    const res = await stack.http.write(ReadinessWrites.runProbes, {}, member);
    expect(res.status).toBe(403);
  });
});
