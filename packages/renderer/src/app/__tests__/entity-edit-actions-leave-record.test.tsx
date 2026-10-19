// entityEdit header actions that delete the shown record (or carry a
// redirect) leave the screen through EntityEditUpdateForm.handleRecordLeft.
// Mirrors the projectionDetail suite: list navigation, returnTo guard,
// redirect, and the reload fallback when there is nowhere to navigate.

import { afterEach, describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { UserRolesProvider } from "../../context/user-roles-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import {
  type BannerProps,
  type ButtonProps,
  type CorePrimitives,
  type DialogProps,
  type FormProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import { AppFeaturesProvider } from "../app-features-context.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import type { NavApi, ScreenTarget } from "../nav.tsx";
import { NavProvider } from "../nav.tsx";

afterEach(cleanup);

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId }) => (
  <button type="button" data-testid={testId} onClick={() => void onClick?.()}>
    {children}
  </button>
);

const TestBanner: ComponentType<BannerProps> = ({ children, testId }) => (
  <div data-testid={testId}>{children}</div>
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

const dialogSpy: { current: DialogProps | null } = { current: null };
const TestDialog = (props: DialogProps): ReactNode => {
  if (props.open) dialogSpy.current = props;
  return null;
};

const testPrimitives: CorePrimitives = {
  Button: TestButton,
  Banner: TestBanner,
  Field: passChildren,
  Input: noop,
  DataTable: noop,
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
  Dialog: TestDialog,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

type Calls = { writes: number; detailQueries: number; listQueries: number };

function stubDispatcher(calls: Calls): Dispatcher {
  return {
    write: (async () => {
      calls.writes += 1;
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
    query: (async (qn: string) => {
      if (qn.endsWith(":list")) {
        calls.listQueries += 1;
        return { isSuccess: true, data: { rows: [{ id: "rent-1" }], nextCursor: null } };
      }
      calls.detailQueries += 1;
      return { isSuccess: true, data: { id: "rent-1", version: 1, name: "April" } };
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

const deleteAction = {
  kind: "writeHandler",
  id: "delete",
  label: "actions.delete",
  handler: "app:write:rent:delete",
  style: "danger",
  confirm: "actions.deleteConfirm",
} as const;

const archiveAction = {
  kind: "writeHandler",
  id: "archive",
  label: "actions.archive",
  handler: "app:write:rent:archive",
} as const;

const entity: EntityDefinition = {
  fields: {
    name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
  },
};

function schemaWith(opts: {
  readonly actions: EntityEditScreenDefinition["actions"];
  readonly withList: boolean;
  readonly singleton?: boolean;
  readonly redirect?: string;
  readonly withSummaryScreen?: boolean;
}): FeatureSchema {
  const editScreen = {
    id: "rent-edit",
    type: "entityEdit",
    entity: "rent",
    layout: { sections: [{ columns: 1, fields: ["name"] }] },
    actions: opts.actions,
    ...(opts.singleton === true && { singleton: true }),
  } as EntityEditScreenDefinition;
  const listScreen = {
    id: "rent-list",
    type: "entityList",
    entity: "rent",
    columns: ["name"],
  } as unknown as FeatureSchema["screens"][number];
  const overview = { ...listScreen, id: "rent-overview", entity: opts.withList ? "rent" : "other" };
  const summary = {
    id: "rent-summary",
    type: "projectionDetail",
    query: "app:query:rent:summary",
    layout: {
      mode: "tabs",
      sections: [{ id: "payments", title: "Payments", fields: ["name"] }],
    },
  } as unknown as FeatureSchema["screens"][number];
  const base = opts.withList ? [editScreen, listScreen, overview] : [editScreen, overview];
  return {
    featureName: "app",
    entities: { rent: entity },
    screens: opts.withSummaryScreen === true ? [...base, summary] : base,
  } as FeatureSchema;
}

async function runAction(
  schema: FeatureSchema,
  actionId: string,
  searchParams: Readonly<Record<string, string>> = {},
): Promise<{
  readonly navigated: ScreenTarget[];
  readonly navigateSearchParams: (Readonly<Record<string, string>> | undefined)[];
  readonly calls: Calls;
}> {
  dialogSpy.current = null as DialogProps | null;
  const navigated: ScreenTarget[] = [];
  const navigateSearchParams: (Readonly<Record<string, string>> | undefined)[] = [];
  const calls: Calls = { writes: 0, detailQueries: 0, listQueries: 0 };
  const navApi: NavApi = {
    route: { screenId: "app:screen:rent-edit" },
    navigate: (target, options) => {
      if ("screenId" in target) {
        navigated.push(target);
        navigateSearchParams.push(options?.searchParams);
      }
    },
    replace: () => {},
    hrefFor: () => "",
    searchParams,
    setSearchParams: () => {},
  };
  const { getByTestId } = render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher(calls)}>
        <AppFeaturesProvider features={[schema]}>
          <UserRolesProvider roles={[]}>
            <NavProvider value={navApi}>
              <PrimitivesProvider value={testPrimitives}>
                <KumikoScreen
                  schema={schema}
                  qn="app:screen:rent-edit"
                  {...(schema.screens[0]?.type === "entityEdit" &&
                    (schema.screens[0] as EntityEditScreenDefinition).singleton !== true && {
                      entityId: "rent-1",
                    })}
                />
              </PrimitivesProvider>
            </NavProvider>
          </UserRolesProvider>
        </AppFeaturesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
  await waitFor(() => expect(calls.detailQueries).toBeGreaterThan(0));
  await waitFor(() => getByTestId(`render-edit-action-${actionId}`));
  await act(async () => {
    fireEvent.click(getByTestId(`render-edit-action-${actionId}`));
  });
  const dialog = dialogSpy.current;
  if (dialog?.open === true) {
    await act(async () => {
      await dialog.onConfirm();
    });
  }
  await waitFor(() => expect(calls.writes).toBe(1));
  return { navigated, navigateSearchParams, calls };
}

describe("entityEdit actions that leave the shown record", () => {
  test("a confirmed delete navigates to the entity list", async () => {
    const { navigated } = await runAction(
      schemaWith({ actions: [deleteAction], withList: true }),
      "delete",
    );
    await waitFor(() => expect(navigated).toEqual([{ screenId: "rent-list" }]));
  });

  test("a delete with a valid returnTo goes back there instead of the list", async () => {
    const { navigated } = await runAction(
      schemaWith({ actions: [deleteAction], withList: true }),
      "delete",
      { returnTo: "rent-overview" },
    );
    await waitFor(() => expect(navigated).toEqual([{ screenId: "rent-overview" }]));
  });

  test("a delete never returns onto the deleted record", async () => {
    const { navigated } = await runAction(
      schemaWith({ actions: [deleteAction], withList: true }),
      "delete",
      { returnTo: "rent-edit/rent-1" },
    );
    await waitFor(() => expect(navigated).toEqual([{ screenId: "rent-list" }]));
  });

  test("a non-delete action with redirect navigates there", async () => {
    const { navigated } = await runAction(
      schemaWith({
        actions: [{ ...archiveAction, redirect: "rent-overview" }],
        withList: true,
      }),
      "archive",
    );
    await waitFor(() => expect(navigated).toEqual([{ screenId: "rent-overview" }]));
  });

  test("an object-form redirect with a tab opens that tab on the target screen", async () => {
    const { navigated, navigateSearchParams } = await runAction(
      schemaWith({
        actions: [
          {
            ...archiveAction,
            redirect: { screen: "rent-summary", idFrom: "id", tab: "payments" },
          },
        ],
        withList: true,
        withSummaryScreen: true,
      }),
      "archive",
    );
    await waitFor(() =>
      expect(navigated).toEqual([{ screenId: "rent-summary", entityId: "rent-1" }]),
    );
    expect(navigateSearchParams).toEqual([{ tab: "payments" }]);
  });

  test("an object-form redirect without a tab navigates without search params", async () => {
    const { navigated, navigateSearchParams } = await runAction(
      schemaWith({
        actions: [{ ...archiveAction, redirect: { screen: "rent-summary", idFrom: "id" } }],
        withList: true,
        withSummaryScreen: true,
      }),
      "archive",
    );
    await waitFor(() =>
      expect(navigated).toEqual([{ screenId: "rent-summary", entityId: "rent-1" }]),
    );
    expect(navigateSearchParams).toEqual([undefined]);
  });

  test("a delete without any list screen reloads the record instead of staying stale", async () => {
    const { navigated, calls } = await runAction(
      schemaWith({ actions: [deleteAction], withList: false }),
      "delete",
    );
    const queriesAfterWrite = calls.detailQueries;
    await waitFor(() => expect(calls.detailQueries).toBeGreaterThan(1));
    expect(queriesAfterWrite).toBeGreaterThan(0);
    expect(navigated).toEqual([]);
  });

  test("singleton: a delete that carries a redirect still notifies the host (list refetch)", async () => {
    const { calls } = await runAction(
      schemaWith({
        actions: [{ ...deleteAction, redirect: "rent-overview" }],
        withList: true,
        singleton: true,
      }),
      "delete",
    );
    const listQueriesAfterLoad = 1;
    await waitFor(() => expect(calls.listQueries).toBeGreaterThan(listQueriesAfterLoad));
  });

  test("singleton: a non-delete redirect does not report a deletion", async () => {
    const { navigated, calls } = await runAction(
      schemaWith({
        actions: [{ ...archiveAction, redirect: "rent-overview" }],
        withList: true,
        singleton: true,
      }),
      "archive",
    );
    await waitFor(() => expect(navigated).toEqual([{ screenId: "rent-overview" }]));
    // Awaiting full act ticks lets any in-flight refetch land, so the count is a barrier, not a sleep.
    await act(async () => {});
    await act(async () => {});
    expect(calls.listQueries).toBe(1);
  });
});
