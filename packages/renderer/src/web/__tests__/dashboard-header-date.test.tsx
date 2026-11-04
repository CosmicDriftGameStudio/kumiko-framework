// The date in the dashboard header is the server's app clock from the panel's answer,
// not the device clock.

import { afterEach, describe, expect, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  createStaticLocaleResolver,
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
} from "../../index.ts";
import { noteServerClock, resetServerClock } from "../../server-clock.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

const dashboard: DashboardScreenDefinition = {
  id: "overview",
  type: "dashboard",
  panels: [
    {
      kind: "stat",
      id: "open",
      label: "demo:open",
      query: "demo:query:kpi:open",
      valueField: "value",
    },
  ],
};

// 2031-05-06 is a Tuesday and 12:00 UTC is the same calendar day in every zone from UTC-12 to UTC+11.
const PINNED_SERVER_TIME = "2031-05-06T12:00:00Z";

afterEach(resetServerClock);

describe("dashboard header date", () => {
  test("shows the day of the pinned server clock from the answer, not the device clock", async () => {
    const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [dashboard] };
    const dispatcher = createMockDispatcher({
      query: (async () => {
        noteServerClock(new Headers({ "x-kumiko-now": PINNED_SERVER_TIME }));
        return { isSuccess: true, data: { value: 3 } };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "de-DE" })}
        fallbackBundles={[kumikoDefaultTranslations, { "de-DE": { "demo:open": "Offen" } }]}
      >
        <BrowserNav>
          <DispatcherProvider dispatcher={dispatcher}>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn="demo:screen:overview" />
            </DashboardBodyProvider>
          </DispatcherProvider>
        </BrowserNav>
      </LocaleProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("dashboard-overview-updated-at").textContent).toBe(
        "Dienstag, 6. Mai 2031",
      ),
    );
  });
});
