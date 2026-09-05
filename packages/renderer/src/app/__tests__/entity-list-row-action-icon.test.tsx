// fw-ui-defaults: RowAction had no icon field at all, so every framework-
// generated action button rendered as a same-looking text button. This
// renders the real entityList pipeline (KumikoScreen → EntityListBody) and
// asserts on the resolved `icon` KumikoScreen attaches to each
// DataTableRowAction — the id-derived default (ACTION_ICON_BY_ID in
// kumiko-screen.tsx) for an action with no declared icon, and the declared
// icon overriding that default for one that has it.

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
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type CorePrimitives,
  type DataTableProps,
  type DataTableRowAction,
  PrimitivesProvider,
} from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import { NavProvider } from "../nav";

function stubDispatcher(): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({
      isSuccess: true,
      data: { rows: [{ id: "row-1" }], nextCursor: null, total: 1 },
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

function buildSchema(): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      name: { type: "text", maxLength: 50, required: false, searchable: false, sortable: false },
    },
  };
  const listScreen: EntityListScreenDefinition = {
    id: "widget-list",
    type: "entityList",
    entity: "widget",
    columns: ["name"],
    rowActions: [
      // No declared icon — must fall back to ACTION_ICON_BY_ID["delete"].
      {
        id: "delete",
        label: "Delete",
        handler: "icon-fixture:write:widget:delete",
      },
      // Declared icon on an id that DOES have an id-derived default
      // ("edit" -> pencil) — the declared icon must win.
      {
        kind: "navigate",
        id: "edit",
        label: "Edit",
        screen: "widget-edit",
        icon: "archive",
      },
    ],
  };
  return {
    featureName: "icon-fixture",
    entities: { widget: entity },
    screens: [listScreen],
  } as FeatureSchema;
}

function renderListScreen(): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "icon-fixture:screen:widget-list" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={buildSchema()} qn="icon-fixture:screen:widget-list" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

function requireAction(id: string): DataTableRowAction {
  const action = capturedRowActions?.find((a) => a.id === id);
  if (!action) throw new Error(`expected the '${id}' row action to be captured`);
  return action;
}

describe("entityList rowActions resolve an icon (fw-ui-defaults)", () => {
  test("an action with no declared icon derives it from its id ('delete' -> trash)", async () => {
    capturedRowActions = undefined;

    renderListScreen();

    await waitFor(() => {
      expect(capturedRowActions).toBeDefined();
    });

    expect(requireAction("delete").icon).toBe("trash");
  });

  test("a declared icon overrides the id-derived default ('edit' would derive pencil)", async () => {
    capturedRowActions = undefined;

    renderListScreen();

    await waitFor(() => {
      expect(capturedRowActions).toBeDefined();
    });

    expect(requireAction("edit").icon).toBe("archive");
  });
});
