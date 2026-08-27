// Bug found while archiving a cost-type in solon (kumiko-framework#113-adjacent):
// a `writeHandler` row-action on an entityList screen writes successfully
// (HTTP 200, projection updated) but the list keeps showing the old state,
// because nothing ever refetches the rows query after the write resolves.
// Actions with a `redirect`/navigate target hide this — the screen remount
// reloads everything. This test renders the real list path (KumikoScreen →
// EntityListScreen → EntityListBody → RenderList) under a stub dispatcher
// that counts `query()` calls, and proves the rows query refetches after a
// successful row-action write, but NOT after a failed one (no double-fetch,
// no silent refetch loop).

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type ButtonProps,
  type CorePrimitives,
  type DataTableProps,
  type DataTableRowAction,
  PrimitivesProvider,
} from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import { NavProvider } from "../nav";

let capturedRowActions: readonly DataTableRowAction[] | undefined;
const captureDataTable: ComponentType<DataTableProps> = (props) => {
  capturedRowActions = props.rowActions;
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
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
};

let queryCallCount = 0;
let writeIsSuccess = true;

function stubDispatcher(): Dispatcher {
  return {
    write: (async () => {
      if (!writeIsSuccess) {
        return {
          isSuccess: false,
          error: {
            code: "unknown",
            httpStatus: 500,
            i18nKey: "kumiko:error:unknown",
            message: "boom",
          },
        };
      }
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
    query: (async () => {
      queryCallCount += 1;
      return {
        isSuccess: true,
        data: { rows: [{ id: "unit-1", status: "active" }], nextCursor: null, total: 1 },
      };
    }) as unknown as Dispatcher["query"],
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
      status: {
        type: "text",
        maxLength: 50,
        required: false,
        searchable: false,
        sortable: false,
      },
    },
  };
  const listScreen: EntityListScreenDefinition = {
    id: "unit-list",
    type: "entityList",
    entity: "unit",
    columns: ["status"],
    rowActions: [
      {
        id: "archive",
        label: "Archive",
        handler: "units:write:unit:archive",
      },
    ],
  };
  return {
    featureName: "units",
    entities: { unit: entity },
    screens: [listScreen],
  } as FeatureSchema;
}

function renderListScreen(): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "units:unit-list" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={buildSchema()} qn="units:screen:unit-list" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

function requireArchiveAction(): DataTableRowAction {
  const action = capturedRowActions?.find((a) => a.id === "archive");
  if (!action) throw new Error("expected the 'archive' row action to be captured");
  return action;
}

describe("entityList row-action writeHandler refetches the rows query", () => {
  test("a successful row-action write triggers exactly one refetch", async () => {
    capturedRowActions = undefined;
    queryCallCount = 0;
    writeIsSuccess = true;

    renderListScreen();

    await waitFor(() => {
      expect(capturedRowActions).toBeDefined();
    });

    const countAfterMount = queryCallCount;
    expect(countAfterMount).toBeGreaterThan(0);

    await act(async () => {
      await requireArchiveAction().onTrigger({ id: "unit-1", values: { id: "unit-1" } });
    });

    await waitFor(() => {
      expect(queryCallCount).toBe(countAfterMount + 1);
    });

    // Give any accidental extra refetch a chance to land before asserting
    // there wasn't one (no double-fetch, no refetch loop).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryCallCount).toBe(countAfterMount + 1);
  });

  test("a failed row-action write does not refetch the rows query", async () => {
    capturedRowActions = undefined;
    queryCallCount = 0;
    writeIsSuccess = false;

    renderListScreen();

    await waitFor(() => {
      expect(capturedRowActions).toBeDefined();
    });

    const countAfterMount = queryCallCount;
    expect(countAfterMount).toBeGreaterThan(0);

    await act(async () => {
      await expect(
        requireArchiveAction().onTrigger({ id: "unit-1", values: { id: "unit-1" } }),
      ).rejects.toThrow();
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryCallCount).toBe(countAfterMount);
  });
});

// toolbarActions render through RenderList's `toolbarEnd` slot via the real
// ToolbarActionView primitive, not through the DataTable's `rowActions` prop
// (that's what captureDataTable above captures) — a stub that ignores
// `toolbarEnd` never mounts the button, so this needs its own DataTable stub
// that renders that slot, plus a real Button primitive to click through.
const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId }) => (
  <button type="button" data-testid={testId} onClick={() => void onClick?.()}>
    {children}
  </button>
);

const renderToolbarEnd: ComponentType<DataTableProps> = (props) => <>{props.toolbarEnd}</>;

const toolbarTestPrimitives: CorePrimitives = {
  ...testPrimitives,
  Button: TestButton,
  DataTable: renderToolbarEnd,
};

function buildToolbarSchema(): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      status: {
        type: "text",
        maxLength: 50,
        required: false,
        searchable: false,
        sortable: false,
      },
    },
  };
  const listScreen: EntityListScreenDefinition = {
    id: "unit-list",
    type: "entityList",
    entity: "unit",
    columns: ["status"],
    toolbarActions: [
      {
        kind: "writeHandler",
        id: "sync",
        label: "Sync",
        handler: "units:write:unit:sync",
      },
    ],
  };
  return {
    featureName: "units",
    entities: { unit: entity },
    screens: [listScreen],
  } as FeatureSchema;
}

function renderToolbarListScreen(): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "units:unit-list" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={toolbarTestPrimitives}>
            <KumikoScreen schema={buildToolbarSchema()} qn="units:screen:unit-list" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("entityList toolbarAction writeHandler refetches the rows query", () => {
  test("a successful toolbarAction write triggers exactly one refetch", async () => {
    queryCallCount = 0;
    writeIsSuccess = true;

    renderToolbarListScreen();

    const button = await waitFor(() => screen.getByTestId("render-list-toolbar-action-sync"));
    const countAfterMount = queryCallCount;
    expect(countAfterMount).toBeGreaterThan(0);

    fireEvent.click(button);

    await waitFor(() => {
      expect(queryCallCount).toBe(countAfterMount + 1);
    });

    // Give any accidental extra refetch a chance to land before asserting
    // there wasn't one.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryCallCount).toBe(countAfterMount + 1);
  });
});

// projectionList runs its own writeHandler-refetch path (ProjectionListBody,
// separate from EntityListBody above) — the copy-paste edit that added the
// refetch call there is untested without this.
function buildProjectionListSchema(): FeatureSchema {
  const listScreen: ProjectionListScreenDefinition = {
    id: "unit-projection-list",
    type: "projectionList",
    query: "units:query:unit:list",
    columns: [{ field: "status", label: "Status" }],
    rowActions: [
      {
        kind: "writeHandler",
        id: "archive",
        label: "Archive",
        handler: "units:write:unit:archive",
      },
    ],
  };
  return {
    featureName: "units",
    entities: {},
    screens: [listScreen],
  } as FeatureSchema;
}

function renderProjectionListScreen(): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "units:unit-projection-list" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen
              schema={buildProjectionListSchema()}
              qn="units:screen:unit-projection-list"
            />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("projectionList row-action writeHandler refetches the rows query", () => {
  test("a successful row-action write triggers exactly one refetch", async () => {
    capturedRowActions = undefined;
    queryCallCount = 0;
    writeIsSuccess = true;

    renderProjectionListScreen();

    await waitFor(() => {
      expect(capturedRowActions).toBeDefined();
    });

    const countAfterMount = queryCallCount;
    expect(countAfterMount).toBeGreaterThan(0);

    await act(async () => {
      await requireArchiveAction().onTrigger({ id: "unit-1", values: { id: "unit-1" } });
    });

    await waitFor(() => {
      expect(queryCallCount).toBe(countAfterMount + 1);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryCallCount).toBe(countAfterMount + 1);
  });
});
