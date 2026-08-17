// fw#2166: projectionDetail screens can declare header `actions`, and get a
// default "edit" action for free when `detailFor` names an entity that has a
// visible entityEdit screen somewhere in the app (not just this feature —
// the motivating case is a projectionDetail whose query belongs to one
// feature while the entity's entityEdit screen lives in another). This
// renders the real path (KumikoScreen → ProjectionDetailBody → RenderEdit)
// under a stub dispatcher + AppFeaturesProvider, and proves the default-edit
// resolution rules from the boot-validator's detailFor doc (cross-feature
// lookup, access-gating, id: "edit" declared-action suppression).

import { describe, expect, test } from "bun:test";
import type {
  AccessRule,
  EntityEditScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { UserRolesProvider } from "../../context/user-roles-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type BannerProps,
  type ButtonProps,
  type CorePrimitives,
  type FormProps,
  PrimitivesProvider,
} from "../../primitives";
import { AppFeaturesProvider } from "../app-features-context";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import type { NavApi, ScreenTarget } from "../nav";
import { NavProvider } from "../nav";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId }) => (
  <button type="button" data-testid={testId} onClick={() => void onClick?.()}>
    {children}
  </button>
);

// Form's `actions` slot carries the header buttons under test — passChildren
// alone would drop it. Wrapped in distinct testid'd containers so a test can
// assert a banner rendered as a Form CHILD (formError/actionError region)
// rather than inside the actions row — the review finding this proves.
const FormWithActions: ComponentType<FormProps> = ({ children, actions }) => (
  <>
    <div data-testid="form-body">{children}</div>
    <div data-testid="form-actions">{actions}</div>
  </>
);

// passChildren would drop testId — this test asserts on Banner structure/
// placement, so it needs a real (if minimal) wrapper element.
const TestBanner: ComponentType<BannerProps> = ({ children, testId }) => (
  <div data-testid={testId}>{children}</div>
);

const testPrimitives: CorePrimitives = {
  Button: TestButton,
  Banner: TestBanner,
  Field: passChildren,
  Input: noop,
  DataTable: noop,
  Form: FormWithActions,
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

function stubDispatcher(
  record: Readonly<Record<string, unknown>>,
  writeErrorMessage?: string,
): Dispatcher {
  const writeResult =
    writeErrorMessage !== undefined
      ? {
          isSuccess: false,
          error: {
            code: "write-failed",
            httpStatus: 500,
            i18nKey: "kumiko.errors.does-not-exist-in-any-bundle",
            message: writeErrorMessage,
          },
        }
      : { isSuccess: true, data: {} };
  return {
    write: (async () => writeResult) as unknown as Dispatcher["write"],
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

function detailScreen(
  overrides?: Partial<ProjectionDetailScreenDefinition & { readonly detailFor?: string }>,
): FeatureSchema["screens"][number] {
  return {
    id: "rent-detail",
    type: "projectionDetail",
    query: "app:query:rent:detail",
    layout: { sections: [{ title: "s", fields: ["description"] }] },
    detailFor: "rent",
    ...overrides,
  } as FeatureSchema["screens"][number];
}

// Registry-qualified id ("<feature>:screen:<short>"), matching real schema
// output — a bare short id here would hide the QN-vs-short-form bug this
// test suite exists to catch (fw#2166 review finding 1/4).
function editScreen(
  entity: string,
  access?: AccessRule,
  featureName = "app",
): EntityEditScreenDefinition {
  return {
    id: `${featureName}:screen:rent-edit`,
    type: "entityEdit",
    entity,
    layout: { sections: [{ columns: 1, fields: ["name"] }] },
    ...(access !== undefined && { access }),
  };
}

function renderDetail(opts: {
  readonly primarySchema: FeatureSchema;
  readonly features: readonly FeatureSchema[];
  readonly userRoles?: readonly string[];
  readonly record?: Readonly<Record<string, unknown>>;
  readonly onNavigate?: (target: ScreenTarget) => void;
  readonly writeErrorMessage?: string;
}): ReturnType<typeof render> {
  const navApi: NavApi = {
    route: { screenId: "app:screen:rent-detail" },
    // Header actions only ever navigate with a ScreenTarget (screenId +
    // entityId) — same narrowing idiom as nav.tsx's resolveTarget.
    navigate: (target) => {
      if ("screenId" in target) opts.onNavigate?.(target);
    },
    replace: () => {},
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => {},
  };
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider
        dispatcher={stubDispatcher(
          opts.record ?? { id: "rent-1", description: "Rent for April" },
          opts.writeErrorMessage,
        )}
      >
        <AppFeaturesProvider features={opts.features}>
          <UserRolesProvider roles={opts.userRoles}>
            <NavProvider value={navApi}>
              <PrimitivesProvider value={testPrimitives}>
                <KumikoScreen
                  schema={opts.primarySchema}
                  qn="app:screen:rent-detail"
                  entityId="rent-1"
                />
              </PrimitivesProvider>
            </NavProvider>
          </UserRolesProvider>
        </AppFeaturesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("projectionDetail default edit action (fw#2166)", () => {
  test("detailFor + matching entityEdit in the SAME feature → edit button navigates with the record id", async () => {
    const schema: FeatureSchema = {
      featureName: "app",
      entities: {},
      screens: [detailScreen(), editScreen("rent")],
    };
    let navigated: ScreenTarget | undefined;
    const { getByTestId, queryByText } = renderDetail({
      primarySchema: schema,
      features: [schema],
      userRoles: [],
      onNavigate: (target) => {
        navigated = target;
      },
    });
    await waitFor(() => expect(queryByText("Loading…")).toBeNull());

    // trigger() is async (busy-state bookkeeping around onPress), so the
    // click's state updates land after this tick — act() flushes them.
    await act(async () => {
      fireEvent.click(getByTestId("render-edit-action-edit"));
    });
    expect(navigated).toEqual({ screenId: "rent-edit", entityId: "rent-1" });
  });

  test("edit screen access denied → no edit button", async () => {
    const schema: FeatureSchema = {
      featureName: "app",
      entities: {},
      screens: [detailScreen(), editScreen("rent", { roles: ["admin"] })],
    };
    const { queryByTestId, queryByText } = renderDetail({
      primarySchema: schema,
      features: [schema],
      userRoles: [],
    });
    await waitFor(() => expect(queryByText("Loading…")).toBeNull());

    expect(queryByTestId("render-edit-action-edit")).toBeNull();
  });

  test("no entityEdit screen for the detailFor entity → no edit button", async () => {
    const schema: FeatureSchema = {
      featureName: "app",
      entities: {},
      screens: [detailScreen()],
    };
    const { queryByTestId, queryByText } = renderDetail({
      primarySchema: schema,
      features: [schema],
      userRoles: [],
    });
    await waitFor(() => expect(queryByText("Loading…")).toBeNull());

    expect(queryByTestId("render-edit-action-edit")).toBeNull();
  });

  test('a declared actions entry with id: "edit" wins — exactly one edit button, the declared one', async () => {
    const schema: FeatureSchema = {
      featureName: "app",
      entities: {},
      screens: [
        detailScreen({
          actions: [
            { kind: "navigate", id: "edit", label: "custom-edit-label", screen: "rent-edit" },
          ],
        }),
        editScreen("rent"),
      ],
    };
    const { getAllByTestId, queryByText } = renderDetail({
      primarySchema: schema,
      features: [schema],
      userRoles: [],
    });
    await waitFor(() => expect(queryByText("Loading…")).toBeNull());

    const editButtons = getAllByTestId("render-edit-action-edit");
    expect(editButtons).toHaveLength(1);
    // "custom-edit-label" has no translation registered, so translate()
    // returns the raw key — proving this is the declared action, not the
    // default (which renders the translated "kumiko.actions.edit").
    expect(editButtons[0]?.textContent).toBe("custom-edit-label");
  });

  test("two entityEdit screens for the same entity, only the second accessible → button still renders, targeting the second (review finding 2)", async () => {
    const lockedEdit: EntityEditScreenDefinition = {
      id: "app:screen:rent-edit-locked",
      type: "entityEdit",
      entity: "rent",
      layout: { sections: [{ columns: 1, fields: ["name"] }] },
      access: { roles: ["admin"] },
    };
    const openEdit: EntityEditScreenDefinition = {
      id: "app:screen:rent-edit-open",
      type: "entityEdit",
      entity: "rent",
      layout: { sections: [{ columns: 1, fields: ["name"] }] },
    };
    const schema: FeatureSchema = {
      featureName: "app",
      entities: {},
      screens: [detailScreen(), lockedEdit, openEdit],
    };
    let navigated: ScreenTarget | undefined;
    const { getByTestId, queryByText } = renderDetail({
      primarySchema: schema,
      features: [schema],
      userRoles: [],
      onNavigate: (target) => {
        navigated = target;
      },
    });
    await waitFor(() => expect(queryByText("Loading…")).toBeNull());

    await act(async () => {
      fireEvent.click(getByTestId("render-edit-action-edit"));
    });
    expect(navigated).toEqual({ screenId: "rent-edit-open", entityId: "rent-1" });
  });

  test("declared navigate action without entityId, targeting an entityEdit of the SAME entity → auto-fills the record id (review finding 3)", async () => {
    const schema: FeatureSchema = {
      featureName: "app",
      entities: {},
      screens: [
        detailScreen({
          actions: [
            {
              kind: "navigate",
              id: "open-record",
              label: "actions.openRecord",
              screen: "rent-edit",
            },
          ],
        }),
        editScreen("rent"),
      ],
    };
    let navigated: ScreenTarget | undefined;
    const { getByTestId, queryByText } = renderDetail({
      primarySchema: schema,
      features: [schema],
      userRoles: [],
      onNavigate: (target) => {
        navigated = target;
      },
    });
    await waitFor(() => expect(queryByText("Loading…")).toBeNull());

    await act(async () => {
      fireEvent.click(getByTestId("render-edit-action-open-record"));
    });
    expect(navigated).toEqual({ screenId: "rent-edit", entityId: "rent-1" });
  });

  test("declared action with a non-matching visible condition → no button rendered", async () => {
    const schema: FeatureSchema = {
      featureName: "app",
      entities: {},
      screens: [
        detailScreen({
          actions: [
            {
              kind: "navigate",
              id: "archive",
              label: "actions.archive",
              screen: "rent-edit",
              visible: { field: "status", eq: "closed" },
            },
          ],
        }),
      ],
    };
    const { queryByTestId, queryByText } = renderDetail({
      primarySchema: schema,
      features: [schema],
      userRoles: [],
      record: { id: "rent-1", description: "Rent for April", status: "open" },
    });
    await waitFor(() => expect(queryByText("Loading…")).toBeNull());

    expect(queryByTestId("render-edit-action-archive")).toBeNull();
  });

  test("entityEdit screen lives in ANOTHER feature → edit button is still there (cross-feature resolution)", async () => {
    const appSchema: FeatureSchema = {
      featureName: "app",
      entities: {},
      screens: [detailScreen()],
    };
    const billingSchema: FeatureSchema = {
      featureName: "billing",
      entities: {},
      screens: [editScreen("rent", undefined, "billing")],
    };
    let navigated: ScreenTarget | undefined;
    const { getByTestId, queryByText } = renderDetail({
      primarySchema: appSchema,
      features: [appSchema, billingSchema],
      userRoles: [],
      onNavigate: (target) => {
        navigated = target;
      },
    });
    await waitFor(() => expect(queryByText("Loading…")).toBeNull());

    // trigger() is async (busy-state bookkeeping around onPress), so the
    // click's state updates land after this tick — act() flushes them.
    await act(async () => {
      fireEvent.click(getByTestId("render-edit-action-edit"));
    });
    expect(navigated).toEqual({ screenId: "rent-edit", entityId: "rent-1" });
  });

  test("a failed writeHandler action shows its error in the shared error region, NOT inside the action button row", async () => {
    const schema: FeatureSchema = {
      featureName: "app",
      entities: {},
      screens: [
        detailScreen({
          actions: [
            {
              kind: "writeHandler",
              id: "archive",
              label: "actions.archive",
              handler: "app:write:archive",
            },
          ],
        }),
      ],
    };
    const { getByTestId, queryByText } = renderDetail({
      primarySchema: schema,
      features: [schema],
      userRoles: [],
      writeErrorMessage: "archive failed: rent is still active",
    });
    await waitFor(() => expect(queryByText("Loading…")).toBeNull());

    await act(async () => {
      fireEvent.click(getByTestId("render-edit-action-archive"));
    });

    const errorBanner = await waitFor(() => getByTestId("render-edit-action-error"));
    expect(errorBanner.textContent).toBe("archive failed: rent is still active");
    // The banner must be a Form child (formError-adjacent region), not a
    // descendant of the actions row — a full-width Banner inside the
    // `justify-end` button row breaks its layout (fw#2166 review finding 5).
    expect(errorBanner.closest('[data-testid="form-body"]')).not.toBeNull();
    expect(errorBanner.closest('[data-testid="form-actions"]')).toBeNull();
    expect(
      getByTestId("render-edit-action-archive").closest('[data-testid="form-actions"]'),
    ).not.toBeNull();
  });
});
