// A probe run's events carry system-probe rows, so the audit log must not hand them to a
// TenantAdmin, and a probe only gets the read-side of the job context.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { type TestStack, unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { createAuditFeature } from "../../audit/feature.ts";
import { AuditQueries } from "../../audit/web/constants.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { ReadinessWrites } from "../constants.ts";
import { markEvents, setupReadinessStack } from "./readiness-test-stack.ts";

let probeContextKeys: readonly string[] = [];

const fixtureFeature = defineFeature("probe-audit-fixture", (r) => {
  r.requires({ features: ["readiness"] });
  r.translations({
    keys: {
      "fixture.area": { en: "Fixture" },
      "fixture.label": { en: "Fixture check" },
      "fixture.ok": { en: "fine" },
    },
  });
  r.probe({
    name: "system-only",
    scope: "system",
    cost: "free",
    area: "fixture.area",
    label: "fixture.label",
    run: async (ctx) => {
      probeContextKeys = Object.keys(ctx);
      return { status: "ok", message: { key: "fixture.ok" } };
    },
  });
});

let stack: TestStack;
const tenantId = testTenantId(7301);
const tenantAdmin = createTestUser({ id: 7301, tenantId, roles: ["TenantAdmin"] });
const systemAdmin = createTestUser({ id: 8301, tenantId, roles: ["SystemAdmin"] });

type AuditRow = { readonly id: string; readonly aggregateType: string };
type AuditPage = { readonly rows: readonly AuditRow[] };

beforeAll(async () => {
  stack = await setupReadinessStack({
    features: [createUserFeature(), createAuditFeature(), fixtureFeature],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("readiness run in the audit log", () => {
  test("a SystemAdmin's run stays out of the TenantAdmin's audit list and details, and the probe saw only the read-side context", async () => {
    const newEvents = await markEvents(stack);
    await stack.http.writeOk(ReadinessWrites.runProbes, { includePaid: false }, systemAdmin);
    await stack.drainJobs();
    const runEvents = (await newEvents()).filter((event) => event.aggregateType === "probe-run");
    const finished = runEvents[runEvents.length - 1];
    if (finished === undefined) throw new Error("expected the run's events");
    expect(JSON.stringify(finished.payload)).toContain("probe-audit-fixture:probe:system-only");
    expect([...probeContextKeys].sort()).toEqual(
      [
        "db",
        "obs",
        "probeRunId",
        "registry",
        "services",
        "tenantId",
        "triggeredByEmail",
        "triggeredByUserId",
        "tz",
      ].sort(),
    );

    const tenantView = await stack.http.queryOk<AuditPage>(AuditQueries.list, {}, tenantAdmin);
    expect(tenantView.rows.filter((row) => row.aggregateType === "probe-run")).toEqual([]);
    const filtered = await stack.http.queryOk<AuditPage>(
      AuditQueries.list,
      { aggregateType: "probe-run" },
      tenantAdmin,
    );
    expect(filtered.rows).toEqual([]);
    const details = await stack.http.queryOk<AuditRow | null>(
      AuditQueries.details,
      { id: String(finished.id) },
      tenantAdmin,
    );
    expect(details).toBeNull();

    const systemView = await stack.http.queryOk<AuditPage>(
      AuditQueries.list,
      { aggregateType: "probe-run" },
      systemAdmin,
    );
    expect(systemView.rows.map((row) => row.id)).toContain(String(finished.id));
  });
});
