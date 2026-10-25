// A list screen's chrome is the DataTable's own outer wrapper — no
// FormScreenShell/PageSection sits around it. `screenPadding` is how that
// wrapper reaches the shared screen-padding token, so it has to be set on the
// real list path (KumikoScreen → EntityListScreen → EntityListBody →
// RenderList), not just be available on the primitive.
import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { type CorePrimitives, type DataTableProps, PrimitivesProvider } from "../../primitives.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import { NavProvider } from "../nav.tsx";

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

function buildSchema(fillHeight?: boolean): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      name: {
        type: "text",
        allowPlaintext: "test fixture value, not personal data",
        maxLength: 200,
        required: false,
        searchable: false,
        sortable: false,
      },
    },
  };
  const listScreen: EntityListScreenDefinition = {
    id: "org-list",
    type: "entityList",
    entity: "org",
    columns: ["name"],
    ...(fillHeight !== undefined && { fillHeight }),
  };
  return {
    featureName: "orgs",
    entities: { org: entity },
    screens: [listScreen],
  } as FeatureSchema;
}

async function captureListProps(fillHeight?: boolean): Promise<DataTableProps> {
  let captured: DataTableProps | undefined;
  const capturingDataTable: ComponentType<DataTableProps> = (props) => {
    captured = props;
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
            <KumikoScreen schema={buildSchema(fillHeight)} qn="orgs:screen:org-list" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );

  await waitFor(() => expect(captured).toBeDefined());
  if (captured === undefined) throw new Error("DataTable was not rendered");
  return captured;
}

describe("entityList screen padding", () => {
  test("the list screen marks its table as the screen body", async () => {
    expect((await captureListProps()).screenPadding).toBe(true);
  });
});

describe("entityList fillHeight", () => {
  test("fills the shell height by default (scrollBody)", async () => {
    expect((await captureListProps()).scrollBody).toBe(true);
  });

  test("fillHeight: false restores page scroll (no scrollBody)", async () => {
    expect((await captureListProps(false)).scrollBody).toBeUndefined();
  });
});
