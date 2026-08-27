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
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  RowActionNavigate,
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
  type FormProps,
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

// projectionList.runNavigate has NO row["id"] fallback (unlike EntityListBody
// above) — a projectionList row comes from an arbitrary query without a
// guaranteed "id" field, so an entity-target there requires an explicit
// entityId. This proves that path resolves { entity, id } correctly and
// still forwards `params` via setSearchParams.
function buildProjectionListSchema(rowAction: RowActionNavigate): FeatureSchema {
  const listScreen: ProjectionListScreenDefinition = {
    id: "invoice-projection-list",
    type: "projectionList",
    query: "billing:query:invoice:list",
    columns: [{ field: "status", label: "Status" }],
    rowActions: [rowAction],
  };
  return {
    featureName: "billing",
    entities: {},
    screens: [listScreen],
  } as FeatureSchema;
}

function renderProjectionListScreen(
  schema: FeatureSchema,
  navigateSpy: (target: NavTarget) => void,
  setSearchParamsSpy: (params: Record<string, string | null>) => void,
): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "billing:invoice-projection-list" },
            navigate: navigateSpy,
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: setSearchParamsSpy,
          }}
        >
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={schema} qn="billing:screen:invoice-projection-list" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("projectionList navigate row-action with an entity-target (fw#2228)", () => {
  test("entity-target with entityId calls nav.navigate with { entity, id } and forwards params via setSearchParams", async () => {
    capturedRowActions = undefined;
    const navigateCalls: NavTarget[] = [];
    const searchParamsCalls: Record<string, string | null>[] = [];

    renderProjectionListScreen(
      buildProjectionListSchema({
        kind: "navigate",
        id: "view",
        label: "kumiko.actions.view",
        entity: "invoice",
        entityId: "invoiceId",
        params: { pick: ["status"] },
      }),
      (target) => navigateCalls.push(target),
      (params) => searchParamsCalls.push(params),
    );

    await waitFor(() => {
      expect(capturedRowActions).toBeDefined();
    });

    await requireAction("view").onTrigger({
      id: "proj-1",
      values: { id: "proj-1", invoiceId: "invoice-42", status: "open" },
    });

    expect(navigateCalls).toEqual([{ entity: "invoice", id: "invoice-42" }]);
    expect(searchParamsCalls).toEqual([{ status: "open" }]);
  });
});

// projectionDetail's header actions run through the same entity-target
// resolution (ProjectionDetailBody, no record["id"] fallback either) as a
// distinct code path from both entityList and projectionList above — this
// renders the real KumikoScreen → ProjectionDetailBody → RenderEdit pipeline
// and clicks the real action button.
const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId }) => (
  <button type="button" data-testid={testId} onClick={() => void onClick?.()}>
    {children}
  </button>
);

const FormWithActions: ComponentType<FormProps> = ({ children, actions }) => (
  <>
    <div data-testid="form-body">{children}</div>
    <div data-testid="form-actions">{actions}</div>
  </>
);

const detailTestPrimitives: CorePrimitives = {
  ...testPrimitives,
  Button: TestButton,
  Form: FormWithActions,
};

function detailStubDispatcher(record: Readonly<Record<string, unknown>>): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: record })) as unknown as Dispatcher["query"],
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

function buildProjectionDetailSchema(action: RowActionNavigate): FeatureSchema {
  const detailScreen: ProjectionDetailScreenDefinition = {
    id: "invoice-detail",
    type: "projectionDetail",
    query: "billing:query:invoice:detail",
    layout: { sections: [{ title: "s", fields: ["status"] }] },
    actions: [action],
  };
  return {
    featureName: "billing",
    entities: {},
    screens: [detailScreen],
  } as FeatureSchema;
}

function renderProjectionDetailScreen(
  schema: FeatureSchema,
  record: Readonly<Record<string, unknown>>,
  navigateSpy: (target: NavTarget) => void,
  setSearchParamsSpy: (params: Record<string, string | null>) => void,
): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={detailStubDispatcher(record)}>
        <NavProvider
          value={{
            route: { screenId: "billing:invoice-detail" },
            navigate: navigateSpy,
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: setSearchParamsSpy,
          }}
        >
          <PrimitivesProvider value={detailTestPrimitives}>
            <KumikoScreen
              schema={schema}
              qn="billing:screen:invoice-detail"
              entityId={String(record["id"])}
            />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("projectionDetail navigate action with an entity-target (fw#2228)", () => {
  test("entity-target with entityId calls nav.navigate with { entity, id } and forwards params via setSearchParams", async () => {
    const navigateCalls: NavTarget[] = [];
    const searchParamsCalls: Record<string, string | null>[] = [];

    renderProjectionDetailScreen(
      buildProjectionDetailSchema({
        kind: "navigate",
        id: "view-customer",
        label: "kumiko.actions.view",
        entity: "customer",
        entityId: "customerId",
        params: { pick: ["status"] },
      }),
      { id: "invoice-42", customerId: "cust-7", status: "open" },
      (target) => navigateCalls.push(target),
      (params) => searchParamsCalls.push(params),
    );

    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-action-view-customer"));
    });

    expect(navigateCalls).toEqual([{ entity: "customer", id: "cust-7" }]);
    expect(searchParamsCalls).toEqual([{ status: "open" }]);
  });
});
