// A metric is only clickable when its navigate target resolves on this record.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const metricScreen: ProjectionDetailScreenDefinition = {
  id: "unit-detail",
  type: "projectionDetail",
  query: "units:query:unit:detail",
  idParam: "id",
  metrics: [
    { field: "tenantCount", label: "Tenants", navigate: { tab: "tenants" } },
    {
      field: "ownerCount",
      label: "Owner",
      navigate: { entity: "owner", entityId: "ownerId" },
    },
  ],
  layout: { sections: [{ title: "Unit", fields: ["tenantCount"] }] },
};

function renderMetrics(data: Readonly<Record<string, unknown>>): void {
  const query = (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["query"];
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
      <KumikoScreen
        schema={{ featureName: "units", entities: {}, screens: [metricScreen] }}
        qn="units:screen:unit-detail"
        entityId="unit-1"
      />
    </DispatcherProvider>,
  );
}

const isClickable = (testId: string): boolean =>
  screen.getByTestId(testId).querySelector("button") !== null;

describe("KumikoScreen / projectionDetail — metric navigate", () => {
  test("tab-only metric is always clickable; entityId metric only when the record holds the id", async () => {
    renderMetrics({ tenantCount: 2, ownerCount: 1, ownerId: "" });
    await waitFor(() => screen.getByTestId("kumiko-screen-projection-detail-metric-tenantCount"));
    expect(isClickable("kumiko-screen-projection-detail-metric-tenantCount")).toBe(true);
    expect(isClickable("kumiko-screen-projection-detail-metric-ownerCount")).toBe(false);
  });

  test("entityId metric becomes clickable once the record holds the id", async () => {
    renderMetrics({ tenantCount: 2, ownerCount: 1, ownerId: "o-1" });
    await waitFor(() => screen.getByTestId("kumiko-screen-projection-detail-metric-ownerCount"));
    expect(isClickable("kumiko-screen-projection-detail-metric-ownerCount")).toBe(true);
  });
});
