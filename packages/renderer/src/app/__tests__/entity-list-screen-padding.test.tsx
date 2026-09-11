// A list screen's chrome is the DataTable's own outer wrapper — no
// FormScreenShell/PageSection sits around it. `screenPadding` is how that
// wrapper reaches the shared screen-padding token, so it has to be set on the
// real list path (KumikoScreen → EntityListScreen → EntityListBody →
// RenderList), not just be available on the primitive (fw#2640).
import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { type CorePrimitives, type DataTableProps, PrimitivesProvider } from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import { NavProvider } from "../nav";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

function stubDispatcher(): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], total: 0 },
    })) as unknown as Dispatcher["query"],
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

function buildSchema(): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
    },
  };
  const listScreen: EntityListScreenDefinition = {
    id: "org-list",
    type: "entityList",
    entity: "org",
    columns: ["name"],
  };
  return {
    featureName: "orgs",
    entities: { org: entity },
    screens: [listScreen],
  } as FeatureSchema;
}

describe("entityList screen padding (fw#2640)", () => {
  test("the list screen marks its table as the screen body", async () => {
    let capturedScreenPadding: boolean | undefined;
    const capturingDataTable: ComponentType<DataTableProps> = (props) => {
      capturedScreenPadding = props.screenPadding;
      return null;
    };
    const primitives: CorePrimitives = {
      Button: noop,
      Banner: passChildren,
      Field: passChildren,
      Input: noop,
      DataTable: capturingDataTable,
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
    render(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
        <DispatcherProvider dispatcher={stubDispatcher()}>
          <NavProvider
            value={{
              route: { screenId: "orgs:org-list" },
              navigate: () => {},
              replace: () => {},
              hrefFor: () => "",
              searchParams: {},
              setSearchParams: () => {},
            }}
          >
            <PrimitivesProvider value={primitives}>
              <KumikoScreen schema={buildSchema()} qn="orgs:screen:org-list" />
            </PrimitivesProvider>
          </NavProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(capturedScreenPadding).toBe(true));
  });
});
