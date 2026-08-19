// fw#2216: a projectionList query handler that doesn't honor the PagedRows
// contract ({ rows, nextCursor }) used to fall through `rowsQuery.data?.rows
// ?? []` and silently render an empty table with HTTP 200 (prod bug on
// /session-list). This renders the real path (KumikoScreen →
// ProjectionListBody → RenderList) under a stub dispatcher returning a bare
// array, and proves the renderer-level shape guard surfaces an error banner
// instead of an empty list — plus that a correctly-shaped response still
// renders rows.

import { describe, expect, test } from "bun:test";
import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type BannerProps,
  type CorePrimitives,
  type DataTableProps,
  PrimitivesProvider,
} from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import type { NavApi } from "../nav";
import { NavProvider } from "../nav";

let capturedProps: DataTableProps | undefined;
const captureDataTable: ComponentType<DataTableProps> = (props) => {
  capturedProps = props;
  return null;
};
const getCapturedProps = (): DataTableProps | undefined => capturedProps;
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

// passChildren would drop testId — the bad-shape test asserts on which
// banner rendered, so it needs a real (if minimal) wrapper element.
const TestBanner: ComponentType<BannerProps> = ({ children, testId }) => (
  <div data-testid={testId}>{children}</div>
);

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: TestBanner,
  Field: passChildren,
  Input: noop,
  DataTable: captureDataTable,
  Form: passChildren,
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
};

function stubDispatcher(queryResult: unknown): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: queryResult })) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

function buildSchema(screen: ProjectionListScreenDefinition): FeatureSchema {
  return {
    featureName: "ledger",
    entities: {},
    screens: [screen],
  } as FeatureSchema;
}

const nav: NavApi = {
  route: { screenId: "ledger:screen:schedule-list" },
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

function renderProjectionList(
  screen: ProjectionListScreenDefinition,
  queryResult: unknown,
): ReturnType<typeof render> {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher(queryResult)}>
        <NavProvider value={nav}>
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={buildSchema(screen)} qn="ledger:screen:schedule-list" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

const screen: ProjectionListScreenDefinition = {
  id: "schedule-list",
  type: "projectionList",
  query: "ledger:query:schedule:list",
  columns: ["description"],
};

describe("ProjectionListBody — PagedRows shape guard (fw#2216)", () => {
  test("a bare-array query response renders the bad-shape error banner, not an empty table", async () => {
    capturedProps = undefined;
    const { container } = renderProjectionList(screen, [{ id: "1", description: "acme" }]);

    const banner = await waitFor(() => {
      const el = container.querySelector('[data-testid="kumiko-screen-projection-list-bad-shape"]');
      if (el === null) throw new Error("bad-shape banner not rendered");
      return el;
    });
    expect(banner.textContent).toContain("schedule-list");
    expect(banner.textContent).toContain("ledger:query:schedule:list");
    expect(getCapturedProps()).toBeUndefined();
  });

  test("a correct { rows, nextCursor } response renders the rows, no error banner", async () => {
    capturedProps = undefined;
    const { container } = renderProjectionList(screen, {
      rows: [{ id: "1", description: "acme" }],
      nextCursor: null,
    });

    await waitFor(() => expect(getCapturedProps()).toBeDefined());
    expect(getCapturedProps()?.rows).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="kumiko-screen-projection-list-bad-shape"]'),
    ).toBeNull();
  });
});
