import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { stubDispatcher } from "../../__tests__/stub-dispatcher.ts";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { UserRolesProvider } from "../../context/user-roles-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { PageHeaderSlotAvailableProvider } from "../../page-header-slot.ts";
import {
  type CorePrimitives,
  type PageHeaderProps,
  PrimitivesProvider,
  type StatusBadgeProps,
} from "../../primitives.tsx";
import { AppFeaturesProvider } from "../app-features-context.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import type { NavApi } from "../nav.tsx";
import { NavProvider } from "../nav.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const TestPageHeader = ({ title, status }: PageHeaderProps): ReactNode => (
  <div>
    <h1>{title}</h1>
    {status}
  </div>
);

const TestStatusBadge = ({ value, tone, testId }: StatusBadgeProps): ReactNode => (
  <span data-testid={testId} data-tone={tone ?? "none"}>
    {value}
  </span>
);

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: noop,
  Form: ({ children, headerRegion }) => (
    <div>
      {headerRegion}
      {children}
    </div>
  ),
  Section: passChildren,
  Card: passChildren,
  Grid: passChildren,
  GridCell: passChildren,
  Text: ({ children, testId }) => <span data-testid={testId}>{children}</span>,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
  PageHeader: TestPageHeader,
  StatusBadge: TestStatusBadge,
};

const { dispatcher } = stubDispatcher({
  query: (async () => ({
    isSuccess: true,
    data: { id: "r1", name: "Release 1.2", state: "in_review", due: "2026-11-05" },
  })) as unknown as Dispatcher["query"],
});

const METRIC_VALUE_ID = "kumiko-screen-projection-detail-metric-due-value";
const STATE_FORMAT = { format: "enumOption", keyPrefix: "app.state." } as const;

function renderDetail(options: {
  readonly statusFormat?: boolean;
  readonly layoutFormat?: boolean;
  readonly metricFormat?: boolean;
  readonly tone?: "accent" | "critical";
}): ReturnType<typeof render> {
  const screen = {
    id: "release-detail",
    type: "projectionDetail",
    query: "app:query:release",
    singleton: true,
    header: {
      title: "name",
      status: "state",
      statusTones: { in_review: options.tone ?? "warn" },
      ...(options.statusFormat === true && { statusFormat: STATE_FORMAT }),
    },
    metrics: [
      {
        field: "due",
        label: "app.due",
        ...(options.metricFormat === true && { format: { format: "date" } }),
      },
    ],
    layout: {
      sections: [
        {
          title: "s",
          fields: [
            "name",
            options.layoutFormat === true ? { field: "state", renderer: STATE_FORMAT } : "state",
          ],
        },
      ],
    },
  } as ProjectionDetailScreenDefinition;
  const schema: FeatureSchema = {
    featureName: "app",
    entities: {},
    screens: [screen as FeatureSchema["screens"][number]],
  };
  const navApi: NavApi = {
    route: { screenId: "app:screen:release-detail" },
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => {},
  };
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations, { en: { "app.state.in_review": "In review" } }]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <AppFeaturesProvider features={[schema]}>
          <UserRolesProvider roles={[]}>
            <NavProvider value={navApi}>
              <PageHeaderSlotAvailableProvider value={true}>
                <PrimitivesProvider value={testPrimitives}>
                  <KumikoScreen schema={schema} qn="app:screen:release-detail" />
                </PrimitivesProvider>
              </PageHeaderSlotAvailableProvider>
            </NavProvider>
          </UserRolesProvider>
        </AppFeaturesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

async function statusBadge(view: ReturnType<typeof render>): Promise<HTMLElement> {
  await waitFor(() =>
    expect(view.getAllByTestId("kumiko-screen-projection-detail-status").length).toBeGreaterThan(0),
  );
  const badge = view.getAllByTestId("kumiko-screen-projection-detail-status")[0];
  if (badge === undefined) throw new Error("status badge missing");
  return badge;
}

describe("projectionDetail header status text", () => {
  test("statusFormat translates the badge text while the tone stays on the raw value", async () => {
    const badge = await statusBadge(renderDetail({ statusFormat: true }));
    expect(badge.textContent).toBe("In review");
    expect(badge.getAttribute("data-tone")).toBe("warn");
  });

  test("without statusFormat the layout field's enumOption renderer is used", async () => {
    const badge = await statusBadge(renderDetail({ layoutFormat: true }));
    expect(badge.textContent).toBe("In review");
    expect(badge.getAttribute("data-tone")).toBe("warn");
  });

  test("without any format the raw value is shown", async () => {
    const badge = await statusBadge(renderDetail({}));
    expect(badge.textContent).toBe("in_review");
    expect(badge.getAttribute("data-tone")).toBe("warn");
  });

  test("the accent option tone reaches the badge", async () => {
    const badge = await statusBadge(renderDetail({ tone: "accent" }));
    expect(badge.getAttribute("data-tone")).toBe("accent");
  });

  test("the critical option tone reaches the badge", async () => {
    const badge = await statusBadge(renderDetail({ tone: "critical" }));
    expect(badge.getAttribute("data-tone")).toBe("critical");
  });

  test("metric format formats the displayed value", async () => {
    const view = renderDetail({ metricFormat: true });
    const metric = await waitFor(() => view.getByTestId(METRIC_VALUE_ID));
    expect(metric.textContent).not.toBe("2026-11-05");
    expect(metric.textContent).toContain("2026");
  });

  test("a metric without format keeps the raw value", async () => {
    const view = renderDetail({});
    const metric = await waitFor(() => view.getByTestId(METRIC_VALUE_ID));
    expect(metric.textContent).toBe("2026-11-05");
  });
});
