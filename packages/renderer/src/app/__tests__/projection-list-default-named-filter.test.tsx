// projectionList `defaultNamedFilter`: the chip is active and the filter applied while the URL names none,
// also when the list is embedded as a dashboard screen panel; another chip replaces it.

import { afterEach, describe, expect, test } from "bun:test";
import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { type ComponentType, type ReactNode, useState } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { EmbeddedScreenProvider } from "../../context/embedded-screen-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { type DataTableProps, PrimitivesProvider } from "../../primitives.tsx";
import { createMockDispatcher, createStubPrimitives } from "../../testing.ts";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import type { NavApi } from "../nav.tsx";
import { NavProvider } from "../nav.tsx";

let capturedProps: DataTableProps | undefined;
const captureDataTable: ComponentType<DataTableProps> = (props) => {
  capturedProps = props;
  return null;
};
const getCapturedProps = (): DataTableProps | undefined => capturedProps;
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives = createStubPrimitives({
  Button: noop,
  Banner: passChildren,
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
});

let queryCalls: Array<{ readonly type: string; readonly payload: unknown }> = [];

function stubDispatcher(): Dispatcher {
  return createMockDispatcher({
    write: async () => ({ isSuccess: true, data: {} }),
    query: async (type: string, payload: unknown) => {
      queryCalls.push({ type, payload });
      return { isSuccess: true, data: { rows: [], nextCursor: null } };
    },
    batch: async () => ({ isSuccess: true, results: [] }),
  });
}

function StatefulNav({
  initialParams,
  children,
}: {
  readonly initialParams: Record<string, string>;
  readonly children: ReactNode;
}): ReactNode {
  const [params, setParams] = useState<Record<string, string>>(initialParams);
  const value: NavApi = {
    route: { screenId: "ledger:screen:invoice-list" },
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: params,
    setSearchParams: (updates) => {
      setParams((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(updates)) {
          if (v === null) delete next[k];
          else next[k] = v;
        }
        return next;
      });
    },
  };
  return <NavProvider value={value}>{children}</NavProvider>;
}

const screen: ProjectionListScreenDefinition = {
  id: "invoice-list",
  type: "projectionList",
  query: "ledger:query:invoice:list",
  columns: ["description"],
  namedFilters: [
    { id: "open", label: "Open" },
    { id: "overdue", label: "Overdue" },
  ],
  defaultNamedFilter: "open",
};

function renderList(embedded: boolean, initialParams: Record<string, string> = {}): void {
  const body = <KumikoScreen schema={schemaOf(screen)} qn="ledger:screen:invoice-list" />;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <StatefulNav initialParams={initialParams}>
          <PrimitivesProvider value={testPrimitives}>
            {embedded ? <EmbeddedScreenProvider>{body}</EmbeddedScreenProvider> : body}
          </PrimitivesProvider>
        </StatefulNav>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

function schemaOf(definition: ProjectionListScreenDefinition): FeatureSchema {
  return { featureName: "ledger", entities: {}, screens: [definition] } as FeatureSchema;
}

async function capturedTable(): Promise<DataTableProps> {
  await waitFor(() => expect(capturedProps).toBeDefined());
  const props = getCapturedProps();
  if (props === undefined) throw new Error("DataTable was not rendered");
  return props;
}

function namedFilterOf(payload: unknown): unknown {
  return (payload as { namedFilter?: unknown }).namedFilter;
}

afterEach(() => {
  cleanup();
  queryCalls = [];
  capturedProps = undefined;
});

describe.each([
  { embedded: false, where: "as its own screen" },
  { embedded: true, where: "embedded as a dashboard screen panel" },
])("projectionList defaultNamedFilter $where", ({ embedded }) => {
  test("opens with the default chip active and the filter in the payload", async () => {
    renderList(embedded);

    const table = await capturedTable();

    expect(table.filterValues?.["__namedFilter"]).toEqual(["open"]);
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));
    expect(queryCalls.every((call) => namedFilterOf(call.payload) === "open")).toBe(true);
  });

  test("picking another chip replaces the default, pressing the default chip keeps it", async () => {
    renderList(embedded);
    await capturedTable();

    await act(async () => getCapturedProps()?.onFilterChange?.("__namedFilter", ["overdue"]));
    await waitFor(() =>
      expect(getCapturedProps()?.filterValues?.["__namedFilter"]).toEqual(["overdue"]),
    );
    await waitFor(() => expect(namedFilterOf(queryCalls.at(-1)?.payload)).toBe("overdue"));

    await act(async () => getCapturedProps()?.onFilterChange?.("__namedFilter", ["open"]));
    await waitFor(() =>
      expect(getCapturedProps()?.filterValues?.["__namedFilter"]).toEqual(["open"]),
    );
    await act(async () => getCapturedProps()?.onFilterChange?.("__namedFilter", ["open"]));
    expect(getCapturedProps()?.filterValues?.["__namedFilter"]).toEqual(["open"]);
  });

  test("a filter named in the URL wins over the default", async () => {
    renderList(embedded, { "invoice-list.filter": "overdue" });

    const table = await capturedTable();

    expect(table.filterValues?.["__namedFilter"]).toEqual(["overdue"]);
  });
});
