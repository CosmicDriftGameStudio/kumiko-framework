// Stale-run takeover (injected clock), the event footprint of a run, and the cache probe without Redis.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createManualClock } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ProbeTextKeys, ReadinessQueries, ReadinessWrites } from "../constants.ts";
import { markEvents, setupReadinessStack } from "./readiness-test-stack.ts";

const clock = createManualClock(getTemporal().Now.instant());
const STALE_ADVANCE_MINUTES = 11;

const fixtureFeature = defineFeature("clock-fixture", (r) => {
  r.requires({ features: ["readiness"] });
  r.translations({ keys: { "clock.area": { en: "Fixture" }, "clock.label": { en: "Check" } } });
  r.probe({
    name: "plain",
    scope: "tenant",
    cost: "free",
    area: "clock.area",
    label: "clock.label",
    run: async () => ({ status: "ok", message: { key: "clock.label" } }),
  });
});

type Started = { runId: string; isExisting: boolean };
type RunListRow = { id: string; status: string };

let stack: TestStack;
let nextUser = 800;

beforeAll(async () => {
  stack = await setupReadinessStack({
    features: [fixtureFeature],
    // Hides Redis from the probes: the stack builds it, the context override removes it.
    extraContext: { clock, redis: undefined },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

function freshUsers() {
  nextUser += 1;
  const tenantId = testTenantId(nextUser);
  return {
    tenantAdmin: createTestUser({ id: nextUser, tenantId, roles: ["TenantAdmin"] }),
    systemAdmin: createTestUser({ id: nextUser + 1000, tenantId, roles: ["SystemAdmin"] }),
  };
}

const start = (user: ReturnType<typeof createTestUser>) =>
  stack.http.writeOk<Started>(ReadinessWrites.runProbes, {}, user);

describe("readiness run-probes with injected clock", () => {
  test("a stale active run is abandoned and a new run takes over", async () => {
    const { tenantAdmin } = freshUsers();
    const stale = await start(tenantAdmin);

    clock.advance({ minutes: STALE_ADVANCE_MINUTES });
    const fresh = await start(tenantAdmin);
    await stack.drainJobs();

    expect(fresh.isExisting).toBe(false);
    expect(fresh.runId).not.toBe(stale.runId);
    const list = await stack.http.queryOk<{ rows: RunListRow[] }>(
      ReadinessQueries.runList,
      {},
      tenantAdmin,
    );
    expect(list.rows.find((row) => row.id === stale.runId)?.status).toBe("abandoned");
    expect(list.rows.find((row) => row.id === fresh.runId)?.status).toBe("done");
  });

  test("a run writes events only on its own run entry", async () => {
    const { tenantAdmin, systemAdmin } = freshUsers();
    const newEvents = await markEvents(stack);

    const started = await start(systemAdmin);
    await stack.drainJobs();

    const created = await newEvents();
    expect(created.map((event) => event.type)).toEqual([
      "probe-run.created",
      "probe-run.updated",
      "probe-run.updated",
    ]);
    expect(created.every((event) => event.aggregateId === started.runId)).toBe(true);
    expect(await stack.http.queryOk(ReadinessQueries.latestResults, {}, tenantAdmin)).toBeDefined();
  });

  test("the cache probe is skipped as not configured without Redis", async () => {
    const { systemAdmin } = freshUsers();

    await start(systemAdmin);
    await stack.drainJobs();
    const { rows } = await stack.http.queryOk<{
      rows: { probe: string; status: string; message: { i18nKey: string } }[];
    }>(ReadinessQueries.latestResults, {}, systemAdmin);

    const cache = rows.find((row) => row.probe === "readiness:probe:cache");
    expect(cache?.status).toBe("skipped");
    expect(cache?.message.i18nKey).toBe(ProbeTextKeys.notConfigured);
  });
});
