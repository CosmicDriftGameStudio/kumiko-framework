import { describe, expect, test } from "bun:test";
import { QnTypes, qn, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { METRICS_FEATURE, METRICS_SYSTEM_FEATURE, metricQueryName } from "../constants.js";
import { DEFAULT_METRICS } from "../default-metrics.js";
import { createMetricsFeature, createSystemMetricsFeature } from "../feature.js";
import { defineMetric } from "../types.js";
import {
  ALL_TEST_METRICS,
  countMetric,
  eventsTable,
  fixedClock,
  globalTable,
} from "./metrics-fixtures.js";

describe("metrics boot", () => {
  test("metricQueryName matches the framework qualified name", () => {
    expect(metricQueryName("tenant", "x-y")).toBe(qn(METRICS_FEATURE, QnTypes.query, "x-y"));
    expect(metricQueryName("system", "x-y")).toBe(qn(METRICS_SYSTEM_FEATURE, QnTypes.query, "x-y"));
  });

  test("both features boot and register one query per metric of their scope", () => {
    const tenant = createMetricsFeature({ metrics: ALL_TEST_METRICS, now: fixedClock });
    const system = createSystemMetricsFeature({ metrics: ALL_TEST_METRICS, now: fixedClock });
    expect(() => validateBoot([tenant, system])).not.toThrow();
    expect(Object.keys(tenant.queryHandlers)).not.toContain("global-count");
    expect(Object.keys(system.queryHandlers)).toContain("global-count");
    expect(Object.keys(tenant.queryHandlers)).toContain(countMetric.id);
  });

  test("the eight default metrics are registered by their ids", () => {
    const tenant = createMetricsFeature({ metrics: DEFAULT_METRICS });
    const system = createSystemMetricsFeature({ metrics: DEFAULT_METRICS });
    expect(DEFAULT_METRICS.map((metric) => metric.id)).toEqual([
      "job-runs-by-status",
      "failed-job-runs",
      "tenant-job-failures",
      "deliveries-by-channel",
      "failed-deliveries",
      "active-users",
      "active-tenants",
      "audit-writes",
    ]);
    expect(Object.keys(system.queryHandlers).sort()).toEqual(
      DEFAULT_METRICS.map((metric) => metric.id).sort(),
    );
    expect(Object.keys(tenant.queryHandlers)).toEqual(
      expect.arrayContaining([
        "tenant-job-failures",
        "deliveries-by-channel",
        "failed-deliveries",
        "active-users",
        "audit-writes",
      ]),
    );
    expect(Object.keys(tenant.queryHandlers)).not.toContain("job-runs-by-status");
  });

  describe("definition validation", () => {
    const base = {
      description: "d",
      source: eventsTable,
      measure: { fn: "count" },
      scopes: ["tenant"],
    } as const;
    const build = (metric: ReturnType<typeof defineMetric>) => () =>
      createMetricsFeature({ metrics: [metric] });

    test("rejects an id that is not kebab-case", () => {
      expect(build(defineMetric({ ...base, id: "Not Kebab" }))).toThrow(/Not Kebab/);
    });

    test("rejects duplicate ids", () => {
      const metric = defineMetric({ ...base, id: "dup" });
      expect(() => createMetricsFeature({ metrics: [metric, metric] })).toThrow(/duplicate/);
    });

    test("rejects an unknown groupBy column and names the metric", () => {
      expect(build(defineMetric({ ...base, id: "bad-group", groupBy: "nope" }))).toThrow(
        /bad-group.*nope/,
      );
    });

    test("rejects a timeField that is not timestamptz", () => {
      expect(build(defineMetric({ ...base, id: "bad-time", timeField: "status" }))).toThrow(
        /timestamptz/,
      );
    });

    test("rejects bucket and window without timeField", () => {
      expect(build(defineMetric({ ...base, id: "no-time", bucket: "day" }))).toThrow(/timeField/);
      expect(build(defineMetric({ ...base, id: "no-time-w", window: "7d" }))).toThrow(/timeField/);
    });

    test("rejects stackBy without groupBy and stackBy with bucket", () => {
      expect(build(defineMetric({ ...base, id: "stack-alone", stackBy: "status" }))).toThrow(
        /groupBy/,
      );
      expect(
        build(
          defineMetric({
            ...base,
            id: "stack-bucket",
            timeField: "createdAt",
            bucket: "day",
            groupBy: "userRef",
            stackBy: "status",
          }),
        ),
      ).toThrow(/bucket/);
    });

    test("rejects a tenant-scope metric on a table without tenant column", () => {
      expect(build(defineMetric({ ...base, id: "no-tenant", source: globalTable }))).toThrow(
        /tenant_id/,
      );
    });

    test("rejects an empty scope list", () => {
      expect(build(defineMetric({ ...base, id: "no-scope", scopes: [] }))).toThrow(/scopes/);
    });
  });
});
