// metricsStyle "tiles": the metrics render as dashboard KPI tiles whose icon chip carries the tone.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const tilesScreen: ProjectionDetailScreenDefinition = {
  id: "check-detail",
  type: "projectionDetail",
  query: "checks:query:run:detail",
  idParam: "id",
  metricsStyle: "tiles",
  metrics: [
    { field: "okCount", label: "Passed", tone: "ok", icon: "check-circle" },
    { field: "failedCount", label: "Failed", tone: "negative", icon: "x-circle" },
  ],
  layout: { sections: [{ title: "Run", fields: ["okCount"] }] },
};

function renderTiles(data: Readonly<Record<string, unknown>>): void {
  const query = (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["query"];
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
      <KumikoScreen
        schema={{ featureName: "checks", entities: {}, screens: [tilesScreen] }}
        qn="checks:screen:check-detail"
        entityId="run-1"
      />
    </DispatcherProvider>,
  );
}

function chipOf(testId: string): Element | null {
  return screen.getByTestId(testId).querySelector("svg")?.parentElement ?? null;
}

describe("KumikoScreen / projectionDetail — metric tiles", () => {
  test("draws each metric as a tile with label, value and a toned icon chip", async () => {
    renderTiles({ okCount: 4, failedCount: 1 });

    await waitFor(() => screen.getByTestId("kumiko-screen-projection-detail-metric-okCount"));
    const okTile = screen.getByTestId("kumiko-screen-projection-detail-metric-okCount");
    expect(okTile.textContent).toContain("Passed");
    expect(okTile.textContent).toContain("4");
    expect(okTile.closest("dl")).toBeNull();
    expect(chipOf("kumiko-screen-projection-detail-metric-okCount")?.className).toContain(
      "text-status-ok",
    );
    expect(chipOf("kumiko-screen-projection-detail-metric-failedCount")?.className).toContain(
      "text-status-bad",
    );
  });

  test("a zero value keeps the neutral tone instead of the alarm color", async () => {
    renderTiles({ okCount: 4, failedCount: 0 });

    await waitFor(() => screen.getByTestId("kumiko-screen-projection-detail-metric-failedCount"));
    const chipClass = chipOf("kumiko-screen-projection-detail-metric-failedCount")?.className;
    expect(chipClass).toContain("bg-muted");
    expect(chipClass).not.toContain("text-status-bad");
  });
});
