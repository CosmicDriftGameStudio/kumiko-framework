// The queries behind the system-check screen: the summary row exists before the first run,
// failed rows carry their fix link, and the history names who started a run.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, ProbeFailure } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ReadinessQueries, ReadinessWrites } from "../constants.ts";
import { SYSTEM_CHECK_SCREEN_QN } from "../screens.ts";
import { setupReadinessStack } from "./readiness-test-stack.ts";

const fixtureFeature = defineFeature("screen-fixture", (r) => {
  r.requires({ features: ["readiness"] });
  r.translations({
    keys: {
      "screen-fixture.area": { en: "Fixture" },
      "screen-fixture.label": { en: "Fixture check" },
      "screen-fixture.ok": { en: "fine" },
      "screen-fixture.fail": { en: "broken" },
    },
  });
  const common = {
    area: "screen-fixture.area",
    label: "screen-fixture.label",
    scope: "tenant",
    fixScreen: SYSTEM_CHECK_SCREEN_QN,
  } as const;
  r.probe({
    ...common,
    name: "passing",
    cost: "free",
    run: async () => ({ status: "ok", message: { key: "screen-fixture.ok" } }),
  });
  r.probe({
    ...common,
    name: "failing",
    cost: "free",
    run: async () => {
      throw new ProbeFailure({ key: "screen-fixture.fail" });
    },
  });
  r.probe({
    ...common,
    name: "paid",
    cost: "paid",
    run: async () => ({ status: "ok", message: { key: "screen-fixture.ok" } }),
  });
});

type Summary = {
  id: string;
  runId: string | null;
  hasPaidProbes: boolean;
  okCount: number;
  failedCount: number;
  skippedCount: number;
};
type ResultRow = { probe: string; status: string; fixScreen?: string };
type HistoryRow = { id: string; triggeredByName: string; outcome: string };

let stack: TestStack;

beforeAll(async () => {
  stack = await setupReadinessStack({ features: [fixtureFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("system-check screen queries", () => {
  test("the summary has a row and the paid flag before the first run", async () => {
    const tenantId = testTenantId(801);
    const admin = createTestUser({ id: 801, tenantId, roles: ["TenantAdmin"] });

    const summary = await stack.http.queryOk<Summary>(ReadinessQueries.latestSummary, {}, admin);

    expect(summary).toMatchObject({
      id: tenantId,
      runId: null,
      hasPaidProbes: true,
      okCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });
  });

  test("a run shows up in summary, results and history; only failed rows link a fix", async () => {
    const admin = createTestUser({ id: 802, tenantId: testTenantId(802), roles: ["TenantAdmin"] });

    const { runId } = await stack.http.writeOk<{ runId: string }>(
      ReadinessWrites.runProbes,
      {},
      admin,
    );
    await stack.drainJobs();

    const summary = await stack.http.queryOk<Summary>(ReadinessQueries.latestSummary, {}, admin);
    expect(summary).toMatchObject({
      id: runId,
      runId,
      okCount: 1,
      failedCount: 1,
      skippedCount: 1,
    });

    const { rows } = await stack.http.queryOk<{ rows: ResultRow[]; nextCursor: null }>(
      ReadinessQueries.runResults,
      { runId },
      admin,
    );
    const fixOf = (name: string) =>
      rows.find((row) => row.probe === `screen-fixture:probe:${name}`)?.fixScreen;
    expect(fixOf("failing")).toBe(SYSTEM_CHECK_SCREEN_QN);
    expect(fixOf("passing")).toBeUndefined();
    expect(fixOf("paid")).toBeUndefined();

    const history = await stack.http.queryOk<{ rows: HistoryRow[] }>(
      ReadinessQueries.runList,
      {},
      admin,
    );
    // Without the user feature mounted the starter falls back to the user id.
    expect(history.rows).toEqual([
      expect.objectContaining({ id: runId, triggeredByName: admin.id, outcome: "failed" }),
    ]);
  });
});
