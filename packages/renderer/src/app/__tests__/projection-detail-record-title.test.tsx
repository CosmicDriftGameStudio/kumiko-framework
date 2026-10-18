import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { UserRolesProvider } from "../../context/user-roles-context.tsx";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { PageHeaderSlotAvailableProvider } from "../../page-header-slot.ts";
import {
  type CorePrimitives,
  type FormProps,
  type PageHeaderProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import { AppFeaturesProvider } from "../app-features-context.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import type { NavApi } from "../nav.tsx";
import { NavProvider } from "../nav.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const TestForm: ComponentType<FormProps> = ({ children, title, headerRegion }) => (
  <div data-testid="form-body">
    {headerRegion}
    {title !== undefined && <h2 data-testid="form-title">{title}</h2>}
    {children}
  </div>
);

const TestPageHeader: ComponentType<PageHeaderProps> = ({ title }) => (
  <h1 data-testid="page-header-title">{title}</h1>
);

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: noop,
  Form: TestForm,
  Section: passChildren,
  Card: passChildren,
  Grid: passChildren,
  GridCell: passChildren,
  Text: passChildren,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
  PageHeader: TestPageHeader,
};

const dispatcher = {
  write: async () => ({ isSuccess: true, data: {} }),
  query: async () => ({ isSuccess: true, data: { id: "r1", name: "Release 1.2" } }),
  batch: async () => ({ isSuccess: true, results: [] }),
  statusStore: { getState: () => "online", subscribe: () => () => {} },
  async *stream() {},
  pendingWrites: () => [],
  pendingFiles: () => [],
} as unknown as Dispatcher;

function renderDetail(recordTitleField: string | undefined): ReturnType<typeof render> {
  const screen = {
    id: "release-detail",
    type: "projectionDetail",
    query: "app:query:release",
    singleton: true,
    ...(recordTitleField !== undefined && { recordTitleField }),
    layout: { sections: [{ title: "s", fields: ["name"] }] },
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
      fallbackBundles={[kumikoDefaultTranslations]}
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

describe("projectionDetail recordTitleField through the real screen path", () => {
  test("the record title shows once in the page header and no type-title block precedes the form", async () => {
    const { getByTestId, queryByTestId, getAllByTestId } = renderDetail("name");
    await waitFor(() => expect(getByTestId("form-body")).toBeTruthy());
    expect(getAllByTestId("page-header-title")).toHaveLength(1);
    expect(getByTestId("page-header-title").textContent).toBe("Release 1.2");
    expect(queryByTestId("form-title")).toBeNull();
  });

  test("without recordTitleField the page header shows the screen title as before", async () => {
    const { getByTestId } = renderDetail(undefined);
    await waitFor(() => expect(getByTestId("page-header-title")).toBeTruthy());
    expect(getByTestId("page-header-title").textContent).toBe("release-detail");
  });
});
