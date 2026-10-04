import { describe, expect, test } from "bun:test";
import { defineMetric, type MetricDefinition } from "../types.js";
import { validateMetrics } from "../validate.js";
import { eventsTable, filesTable } from "./metrics-fixtures.js";

const base = {
  id: "files-filtered",
  description: "Files",
  source: filesTable,
  measure: { fn: "count" },
  scopes: ["tenant"],
} as const satisfies MetricDefinition;

const withFilters = (
  filters: NonNullable<MetricDefinition["filters"]>,
  extra: Partial<MetricDefinition> = {},
): MetricDefinition => defineMetric({ ...base, filters, ...extra });

describe("validateMetrics — filter resolvers", () => {
  const resolver = { column: "folderId", resolve: async () => [] };

  test("accepts a resolver on a tenant-only metric", () => {
    expect(() => validateMetrics([withFilters({ tree: resolver })])).not.toThrow();
  });

  test("rejects a resolver on a metric with scope system", () => {
    expect(() =>
      validateMetrics([withFilters({ tree: resolver }, { scopes: ["tenant", "system"] })]),
    ).toThrow(/cannot be combined with scope "system"/);
  });

  test("applies the column rules to the resolver column", () => {
    expect(() =>
      validateMetrics([withFilters({ tree: { ...resolver, column: "tenantId" } })]),
    ).toThrow(/tenant column/);
    expect(() =>
      validateMetrics([withFilters({ tree: { ...resolver, column: "ghost" } })]),
    ).toThrow(/not a column/);
  });
});

describe("validateMetrics — filters", () => {
  test("accepts uuid, text and numeric columns", () => {
    expect(() =>
      validateMetrics([
        withFilters({ folderId: "folderId", kind: "kind", sizeClass: "sizeClass" }),
      ]),
    ).not.toThrow();
  });

  test.each(["folder_id", "FolderId", "1folder", "folder-id", ""])(
    "rejects the payload key %p that is not a camelCase identifier",
    (key) => {
      expect(() => validateMetrics([withFilters({ [key]: "folderId" })])).toThrow(/camelCase/);
    },
  );

  test.each(["range", "timeZone", "tenantId"])("rejects the reserved payload key %s", (key) => {
    expect(() => validateMetrics([withFilters({ [key]: "folderId" })])).toThrow(/reserved/);
  });

  test("rejects a column that does not exist", () => {
    expect(() => validateMetrics([withFilters({ ghost: "ghost" })])).toThrow(/not a column/);
  });

  test("rejects the tenant column", () => {
    expect(() => validateMetrics([withFilters({ owner: "tenantId" })])).toThrow(/tenant column/);
  });

  test("rejects a column already fixed by the metric where", () => {
    expect(() =>
      validateMetrics([withFilters({ kind: "kind" }, { where: { kind: "pdf" } })]),
    ).toThrow(/already fixed by the metric where/);
  });

  test("rejects column types that a payload value cannot be validated against", () => {
    expect(() => validateMetrics([withFilters({ archived: "archived" })])).toThrow(
      /only uuid, text and numeric/,
    );
    expect(() =>
      validateMetrics([
        defineMetric({
          ...base,
          id: "events-by-time",
          source: eventsTable,
          filters: { createdAt: "createdAt" },
        }),
      ]),
    ).toThrow(/only uuid, text and numeric/);
  });
});
