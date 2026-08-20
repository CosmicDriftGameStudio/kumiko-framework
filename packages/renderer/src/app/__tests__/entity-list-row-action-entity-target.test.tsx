// fw#2228: RowActionNavigate can now name an ObjectTarget (`entity`) instead
// of a ScreenTarget (`screen`). This renders the real entityList pipeline
// (KumikoScreen → EntityListBody) and asserts a click on the entity-target
// row action calls nav.navigate with `{ entity, id }` — resolution to an
// actual screen is the NavApi impl's job (renderer-web's resolveTarget), not
// this platform-neutral package's. Mirrors
// entity-list-row-action-kumiko-actions-view.test.tsx's harness.

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
import type { NavTarget } from "../nav";
import { NavProvider } from "../nav";

function stubDispatcher(): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({
      isSuccess: true,
      data: {
        rows: [{ id: "invoice-42", customerId: "cust-7", status: "open" }],
        nextCursor: null,
        total: 1,
      },
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

function buildSchema(rowAction: EntityListScreenDefinition["rowActions"]): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      customerId: {
        type: "text",
        maxLength: 50,
        required: false,
        searchable: false,
        sortable: false,
      },
      status: { type: "text", maxLength: 50, required: false, searchable: false, sortable: false },
    },
  };
  const listScreen: EntityListScreenDefinition = {
    id: "invoice-list",
    type: "entityList",
    entity: "invoice",
    columns: ["status"],
    rowActions: rowAction,
  };
  return {
    featureName: "billing",
    entities: { invoice: entity },
    screens: [listScreen],
  } as FeatureSchema;
}

function renderListScreen(schema: FeatureSchema, navigateSpy: (target: NavTarget) => void): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "billing:invoice-list" },
            navigate: navigateSpy,
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={schema} qn="billing:screen:invoice-list" />
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

describe("entityList navigate row-action with an entity-target (fw#2228)", () => {
  test("clicking the row action calls nav.navigate with { entity, id }, not a screenId", async () => {
    capturedRowActions = undefined;
    const navigateCalls: NavTarget[] = [];

    renderListScreen(
      buildSchema([
        { kind: "navigate", id: "view", label: "kumiko.actions.view", entity: "invoice" },
      ]),
      (target) => navigateCalls.push(target),
    );

    await waitFor(() => {
      expect(capturedRowActions).toBeDefined();
    });

    await requireAction("view").onTrigger({
      id: "invoice-42",
      values: { id: "invoice-42", customerId: "cust-7", status: "open" },
    });

    expect(navigateCalls).toHaveLength(1);
    expect(navigateCalls[0]).toEqual({ entity: "invoice", id: "invoice-42" });
  });

  test("an explicit entityId field-name still overrides the row['id'] default", async () => {
    capturedRowActions = undefined;
    const navigateCalls: NavTarget[] = [];

    renderListScreen(
      buildSchema([
        {
          kind: "navigate",
          id: "view-customer",
          label: "kumiko.actions.view",
          entity: "customer",
          entityId: "customerId",
        },
      ]),
      (target) => navigateCalls.push(target),
    );

    await waitFor(() => {
      expect(capturedRowActions).toBeDefined();
    });

    await requireAction("view-customer").onTrigger({
      id: "invoice-42",
      values: { id: "invoice-42", customerId: "cust-7" },
    });

    expect(navigateCalls).toEqual([{ entity: "customer", id: "cust-7" }]);
  });
});
