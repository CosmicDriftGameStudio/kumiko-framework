// A metric's relativeTime format follows the UI locale, not the browser's.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
} from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const NOW = Date.parse("2026-11-07T12:00:00Z");

const detail: ProjectionDetailScreenDefinition = {
  id: "case-detail",
  type: "projectionDetail",
  query: "cases:query:case:detail",
  idParam: "id",
  metrics: [
    { field: "receivedAt", label: "Received", format: { format: "relativeTime" } },
    {
      field: "receivedShort",
      label: "Received short",
      format: { format: "relativeTime", style: "short" },
    },
  ],
  layout: { sections: [{ title: "Case", fields: ["receivedAt"] }] },
};

function renderDetail(locale: string): void {
  const data = { receivedAt: NOW - 42 * 60_000, receivedShort: NOW - 42 * 60_000 };
  const query = (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["query"];
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen
          schema={{ featureName: "cases", entities: {}, screens: [detail] }}
          qn="cases:screen:case-detail"
          entityId="case-1"
        />
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("projectionDetail metric relativeTime locale", () => {
  const realNow = Date.now;
  beforeEach(() => {
    Date.now = () => NOW;
  });
  afterEach(() => {
    Date.now = realNow;
  });

  test("a German UI shows the metric in German", async () => {
    renderDetail("de");

    await waitFor(() => screen.getByTestId("kumiko-screen-projection-detail-metric-receivedAt"));
    const long = screen.getByTestId("kumiko-screen-projection-detail-metric-receivedAt");
    expect(long.textContent).toContain("vor 42 Minuten");
    const short = screen.getByTestId("kumiko-screen-projection-detail-metric-receivedShort");
    expect(short.textContent).toContain("vor 42 Min.");
  });
});
