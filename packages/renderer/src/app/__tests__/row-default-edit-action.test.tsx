// kumiko-screen-akte-bedienkonzept: entityList and projectionList rowActions
// get a default "Edit" row action for free when the row's entity has a
// visible entityEdit screen — same cross-feature resolution as
// projectionDetail's header defaultEditAction (fw#2166), reused here via
// findEditScreenFor (screen-access.ts). Declared rowActions with id "edit"
// win; access-gating and a missing entityEdit screen both suppress the
// default. Mirrors entity-list-row-action-entity-target.test.tsx's harness.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { UserRolesProvider } from "../../context/user-roles-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type CorePrimitives,
  type DataTableProps,
  type DataTableRowAction,
  PrimitivesProvider,
} from "../../primitives";
import { AppFeaturesProvider } from "../app-features-context";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import type { NavTarget } from "../nav";
import { NavProvider } from "../nav";

function stubDispatcher(rows: readonly Record<string, unknown>[]): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({
      isSuccess: true,
      data: { rows, nextCursor: null, total: rows.length },
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

type Captured = {
  readonly rowActions: readonly DataTableRowAction[] | undefined;
  readonly rowCount: number;
};
let captured: Captured = { rowActions: undefined, rowCount: 0 };
const captureDataTable: ComponentType<DataTableProps> = (props) => {
  captured = { rowActions: props.rowActions, rowCount: props.rows.length };
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

function editScreen(entity: string, roles?: readonly string[]): EntityEditScreenDefinition {
  return {
    id: "app:screen:rent-edit",
    type: "entityEdit",
    entity,
    layout: { sections: [{ columns: 1, fields: ["name"] }] },
    ...(roles !== undefined && { access: { roles } }),
  };
}

function requireAction(id: string): DataTableRowAction {
  const action = captured.rowActions?.find((a) => a.id === id);
  if (!action) throw new Error(`expected the '${id}' row action to be captured`);
  return action;
}

function renderScreen(
  schema: FeatureSchema,
  qn: string,
  navigateSpy: (target: NavTarget) => void,
  userRoles: readonly string[],
): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher([{ id: "row-1", name: "Alice" }])}>
        <AppFeaturesProvider features={[schema]}>
          <UserRolesProvider roles={userRoles}>
            <NavProvider
              value={{
                route: undefined,
                navigate: navigateSpy,
                replace: () => {},
                hrefFor: () => "",
                searchParams: {},
                setSearchParams: () => {},
              }}
            >
              <PrimitivesProvider value={testPrimitives}>
                <KumikoScreen schema={schema} qn={qn} />
              </PrimitivesProvider>
            </NavProvider>
          </UserRolesProvider>
        </AppFeaturesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

const entity: EntityDefinition = {
  fields: {
    name: { type: "text", maxLength: 50, required: false, searchable: false, sortable: false },
  },
};

describe("entityList default edit row action", () => {
  function schemaWith(
    rowActions?: EntityListScreenDefinition["rowActions"],
    includeEdit = true,
  ): FeatureSchema {
    const listScreen: EntityListScreenDefinition = {
      id: "rent-list",
      type: "entityList",
      entity: "rent",
      columns: ["name"],
      ...(rowActions !== undefined && { rowActions }),
    };
    return {
      featureName: "app",
      entities: { rent: entity },
      screens: includeEdit ? [listScreen, editScreen("rent")] : [listScreen],
    };
  }

  test("adds a default edit action at the first position when an entityEdit screen exists", async () => {
    captured = { rowActions: undefined, rowCount: 0 };
    const navigateCalls: NavTarget[] = [];
    renderScreen(schemaWith(undefined), "app:screen:rent-list", (t) => navigateCalls.push(t), []);
    await waitFor(() => expect(captured.rowCount).toBe(1));

    expect(captured.rowActions?.[0]?.id).toBe("edit");
    expect(captured.rowActions?.[0]?.label).toBe("Edit");

    await requireAction("edit").onTrigger({
      id: "row-1",
      values: { id: "row-1", name: "Alice" },
    });
    expect(navigateCalls).toEqual([{ screenId: "rent-edit", entityId: "row-1" }]);
  });

  test("a declared rowAction with id 'edit' wins — no doubling", async () => {
    captured = { rowActions: undefined, rowCount: 0 };
    renderScreen(
      schemaWith([{ kind: "navigate", id: "edit", label: "custom-edit", screen: "rent-edit" }]),
      "app:screen:rent-list",
      () => {},
      [],
    );
    await waitFor(() => expect(captured.rowCount).toBe(1));

    const editActions = captured.rowActions?.filter((a) => a.id === "edit") ?? [];
    expect(editActions).toHaveLength(1);
    // "custom-edit" has no translation registered, so translate() returns
    // the raw key — proving this is the declared action, not the default
    // (whose label is the translated "kumiko.actions.edit" → "Edit").
    expect(editActions[0]?.label).toBe("custom-edit");
  });

  test("no entityEdit screen for the entity → no default edit action", async () => {
    captured = { rowActions: undefined, rowCount: 0 };
    renderScreen(schemaWith(undefined, false), "app:screen:rent-list", () => {}, []);
    await waitFor(() => expect(captured.rowCount).toBe(1));

    expect(captured.rowActions?.some((a) => a.id === "edit") ?? false).toBe(false);
  });

  test("access denied to the entityEdit screen → no default edit action", async () => {
    captured = { rowActions: undefined, rowCount: 0 };
    const listScreen: EntityListScreenDefinition = {
      id: "rent-list",
      type: "entityList",
      entity: "rent",
      columns: ["name"],
    };
    const schema: FeatureSchema = {
      featureName: "app",
      entities: { rent: entity },
      screens: [listScreen, editScreen("rent", ["admin"])],
    };
    renderScreen(schema, "app:screen:rent-list", () => {}, []);
    await waitFor(() => expect(captured.rowCount).toBe(1));

    expect(captured.rowActions?.some((a) => a.id === "edit") ?? false).toBe(false);
  });
});

describe("projectionList default edit row action", () => {
  function schemaWith(
    rowActions?: ProjectionListScreenDefinition["rowActions"],
    includeEdit = true,
  ): FeatureSchema {
    const listScreen: ProjectionListScreenDefinition = {
      id: "rent-projection-list",
      type: "projectionList",
      query: "app:query:rent:list",
      detailFor: "rent",
      columns: [{ field: "name", label: "Name" }],
      ...(rowActions !== undefined && { rowActions }),
    };
    return {
      featureName: "app",
      entities: {},
      screens: includeEdit ? [listScreen, editScreen("rent")] : [listScreen],
    };
  }

  test("adds a default edit action at the first position when detailFor resolves an entityEdit screen", async () => {
    captured = { rowActions: undefined, rowCount: 0 };
    const navigateCalls: NavTarget[] = [];
    renderScreen(
      schemaWith(undefined),
      "app:screen:rent-projection-list",
      (t) => navigateCalls.push(t),
      [],
    );
    await waitFor(() => expect(captured.rowCount).toBe(1));

    expect(captured.rowActions?.[0]?.id).toBe("edit");
    expect(captured.rowActions?.[0]?.label).toBe("Edit");

    await requireAction("edit").onTrigger({
      id: "row-1",
      values: { id: "row-1", name: "Alice" },
    });
    expect(navigateCalls).toEqual([{ screenId: "rent-edit", entityId: "row-1" }]);
  });

  test("a declared rowAction with id 'edit' wins — no doubling", async () => {
    captured = { rowActions: undefined, rowCount: 0 };
    renderScreen(
      schemaWith([{ kind: "navigate", id: "edit", label: "custom-edit", screen: "rent-edit" }]),
      "app:screen:rent-projection-list",
      () => {},
      [],
    );
    await waitFor(() => expect(captured.rowCount).toBe(1));

    const editActions = captured.rowActions?.filter((a) => a.id === "edit") ?? [];
    expect(editActions).toHaveLength(1);
    expect(editActions[0]?.label).toBe("custom-edit");
  });

  test("no detailFor → no default edit action", async () => {
    captured = { rowActions: undefined, rowCount: 0 };
    const listScreen: ProjectionListScreenDefinition = {
      id: "rent-projection-list",
      type: "projectionList",
      query: "app:query:rent:list",
      columns: [{ field: "name", label: "Name" }],
    };
    const schema: FeatureSchema = {
      featureName: "app",
      entities: {},
      screens: [listScreen, editScreen("rent")],
    };
    renderScreen(schema, "app:screen:rent-projection-list", () => {}, []);
    await waitFor(() => expect(captured.rowCount).toBe(1));

    expect(captured.rowActions?.some((a) => a.id === "edit") ?? false).toBe(false);
  });

  test("access denied to the entityEdit screen → no default edit action", async () => {
    captured = { rowActions: undefined, rowCount: 0 };
    renderScreen(
      {
        featureName: "app",
        entities: {},
        screens: [
          {
            id: "rent-projection-list",
            type: "projectionList",
            query: "app:query:rent:list",
            detailFor: "rent",
            columns: [{ field: "name", label: "Name" }],
          },
          editScreen("rent", ["admin"]),
        ],
      },
      "app:screen:rent-projection-list",
      () => {},
      [],
    );
    await waitFor(() => expect(captured.rowCount).toBe(1));

    expect(captured.rowActions?.some((a) => a.id === "edit") ?? false).toBe(false);
  });
});
