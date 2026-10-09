// A navigate action defaults the target's entityId to the current record only
// when the target is an entityEdit of the SAME entity (UPDATE mode, which is
// what the boot validator assumes when it exempts params from URL prefill).
// Targets may live in another feature; cross-entity targets open create.

import { afterEach, describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  RowActionNavigate,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { UserRolesProvider } from "../../context/user-roles-context.js";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import {
  type ButtonProps,
  type CorePrimitives,
  type DataTableProps,
  type DataTableRowAction,
  type FormProps,
  PrimitivesProvider,
} from "../../primitives.js";
import { AppFeaturesProvider } from "../app-features-context.js";
import type { FeatureSchema } from "../feature-schema.js";
import { KumikoScreen } from "../kumiko-screen.js";
import type { NavApi, ScreenTarget } from "../nav.js";
import { NavProvider } from "../nav.js";

afterEach(cleanup);

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId }) => (
  <button type="button" data-testid={testId} onClick={() => void onClick?.()}>
    {children}
  </button>
);

const FormWithActions: ComponentType<FormProps> = ({
  children,
  actions,
  secondaryActions,
  headerRegion,
}) => (
  <>
    {headerRegion}
    {children}
    {secondaryActions}
    {actions}
  </>
);

let capturedRowActions: readonly DataTableRowAction[] | undefined;
const captureDataTable: ComponentType<DataTableProps> = (props) => {
  capturedRowActions = props.rowActions;
  return null;
};

const testPrimitives: CorePrimitives = {
  Button: TestButton,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: captureDataTable,
  Form: FormWithActions,
  Section: passChildren,
  Card: ({ slots, children }) => (
    <>
      {slots?.headerActions}
      {children}
    </>
  ),
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

function stubDispatcher(): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async (qn: string) =>
      qn.endsWith(":list")
        ? { isSuccess: true, data: { rows: [{ id: "rent-1", name: "April" }], nextCursor: null } }
        : {
            isSuccess: true,
            data: { id: "rent-1", version: 1, name: "April" },
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

const rentEntity: EntityDefinition = {
  fields: {
    name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
  },
};

const sameEntityOtherFeature: FeatureSchema = {
  featureName: "billing",
  entities: {},
  screens: [
    {
      id: "rent-billing-edit",
      type: "entityEdit",
      entity: "rent",
      layout: { sections: [{ columns: 1, fields: ["name"] }] },
    } as EntityEditScreenDefinition,
    {
      id: "unit-create",
      type: "entityEdit",
      entity: "unit",
      layout: { sections: [{ columns: 1, fields: ["name"] }] },
    } as EntityEditScreenDefinition,
  ],
} as FeatureSchema;

const toSameEntity: RowActionNavigate = {
  kind: "navigate",
  id: "to-same",
  label: "same",
  screen: "rent-billing-edit",
};
const toOtherEntity: RowActionNavigate = {
  kind: "navigate",
  id: "to-other",
  label: "other",
  screen: "unit-create",
};

function navApiFor(navigated: ScreenTarget[], screenId: string): NavApi {
  return {
    route: { screenId },
    navigate: (target) => {
      if ("screenId" in target) navigated.push(target);
    },
    replace: () => {},
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => {},
  };
}

function wrap(schema: FeatureSchema, navApi: NavApi, children: ReactNode): ReactNode {
  return (
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <AppFeaturesProvider features={[schema, sameEntityOtherFeature]}>
          <UserRolesProvider roles={[]}>
            <NavProvider value={navApi}>
              <PrimitivesProvider value={testPrimitives}>{children}</PrimitivesProvider>
            </NavProvider>
          </UserRolesProvider>
        </AppFeaturesProvider>
      </DispatcherProvider>
    </LocaleProvider>
  );
}

function requireRowAction(id: string): DataTableRowAction {
  const found = capturedRowActions?.find((a) => a.id === id);
  if (found === undefined) throw new Error(`row action ${id} not captured`);
  return found;
}

describe("entityList rowAction navigate: default entityId", () => {
  async function triggerFromList(action: RowActionNavigate): Promise<ScreenTarget[]> {
    capturedRowActions = undefined;
    const navigated: ScreenTarget[] = [];
    const listScreen: EntityListScreenDefinition = {
      id: "rent-list",
      type: "entityList",
      entity: "rent",
      columns: ["name"],
      rowActions: [action],
    };
    const schema = {
      featureName: "app",
      entities: { rent: rentEntity },
      screens: [listScreen],
    } as FeatureSchema;
    render(
      wrap(
        schema,
        navApiFor(navigated, "app:screen:rent-list"),
        <KumikoScreen schema={schema} qn="app:screen:rent-list" />,
      ),
    );
    await waitFor(() => expect(capturedRowActions).toBeDefined());
    const rowAction = requireRowAction(action.id);
    await act(async () => {
      await rowAction.onTrigger({ id: "rent-1", values: { id: "rent-1", name: "April" } });
    });
    return navigated;
  }

  test("a same-entity entityEdit of another feature opens the clicked row (UPDATE mode)", async () => {
    const navigated = await triggerFromList(toSameEntity);
    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toMatchObject({ screenId: "rent-billing-edit", entityId: "rent-1" });
  });

  test("a cross-entity entityEdit target gets no entityId (create mode)", async () => {
    const navigated = await triggerFromList(toOtherEntity);
    expect(navigated).toHaveLength(1);
    expect(navigated[0]?.screenId).toBe("unit-create");
    expect(navigated[0]?.entityId).toBeUndefined();
  });
});

describe("entityEdit action navigate: default entityId", () => {
  async function pressFromEdit(action: RowActionNavigate): Promise<ScreenTarget[]> {
    const navigated: ScreenTarget[] = [];
    const editScreen = {
      id: "rent-edit",
      type: "entityEdit",
      entity: "rent",
      layout: { sections: [{ columns: 1, fields: ["name"] }] },
      actions: [action],
    } as EntityEditScreenDefinition;
    const schema = {
      featureName: "app",
      entities: { rent: rentEntity },
      screens: [editScreen],
    } as FeatureSchema;
    const { getByTestId } = render(
      wrap(
        schema,
        navApiFor(navigated, "app:screen:rent-edit"),
        <KumikoScreen schema={schema} qn="app:screen:rent-edit" entityId="rent-1" />,
      ),
    );
    await waitFor(() => getByTestId(`render-edit-action-${action.id}`));
    await act(async () => {
      fireEvent.click(getByTestId(`render-edit-action-${action.id}`));
    });
    return navigated;
  }

  test("a same-entity entityEdit of another feature opens the shown record", async () => {
    const navigated = await pressFromEdit(toSameEntity);
    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toMatchObject({ screenId: "rent-billing-edit", entityId: "rent-1" });
  });

  test("a cross-entity entityEdit target does not receive the shown record's id", async () => {
    const navigated = await pressFromEdit(toOtherEntity);
    expect(navigated).toHaveLength(1);
    expect(navigated[0]?.screenId).toBe("unit-create");
    expect(navigated[0]?.entityId).toBeUndefined();
  });
});
