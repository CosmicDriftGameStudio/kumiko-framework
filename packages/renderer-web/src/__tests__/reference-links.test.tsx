import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  AppFeaturesProvider,
  createStaticLocaleResolver,
  DispatcherProvider,
  type FeatureSchema,
  formatPath,
  kumikoDefaultTranslations,
  LiveEventsProvider,
  LocaleProvider,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  RenderEdit,
  RenderList,
  resolveTarget,
  TokensProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { defaultPrimitives } from "../primitives/index.tsx";
import { defaultTokens } from "../tokens.ts";
import { createMockDispatcher } from "./test-utils.tsx";

const OWNER_ID = "o-1";
const OTHER_OWNER_ID = "o-2";

const stubTokens = {
  tokens: defaultTokens,
  mode: "dark" as const,
  setMode: () => {},
  toggleMode: () => {},
};

function featureWith(access?: { roles: string[] }): FeatureSchema {
  return {
    featureName: "people",
    entities: {},
    screens: [
      {
        id: "owner-detail",
        type: "projectionDetail",
        detailFor: "owner",
        ...(access !== undefined && { access }),
      },
    ],
  } as unknown as FeatureSchema;
}

const noDetailFeature = {
  featureName: "people",
  entities: {},
  screens: [],
} as unknown as FeatureSchema;

function navFor(
  features: readonly FeatureSchema[],
): NavApi & { navigate: ReturnType<typeof mock> } {
  return {
    route: undefined,
    navigate: mock(),
    replace: () => {},
    hrefFor: (target) => formatPath(resolveTarget(features, target)),
    searchParams: {},
    setSearchParams: () => {},
  };
}

type Setup = {
  readonly features?: readonly FeatureSchema[];
  readonly roles?: readonly string[];
  readonly withNav?: boolean;
  readonly dispatcher?: Dispatcher;
};

function renderWith(
  ui: ReactElement,
  setup: Setup = {},
): { nav: ReturnType<typeof navFor> } & RenderResult {
  cleanup();
  const features = setup.features ?? [featureWith()];
  const nav = navFor(features);
  function Wrapper({ children }: { readonly children: ReactNode }): ReactElement {
    const inner = (
      <DispatcherProvider dispatcher={setup.dispatcher ?? createMockDispatcher()}>
        <LiveEventsProvider value={() => () => {}}>{children}</LiveEventsProvider>
      </DispatcherProvider>
    );
    return (
      <TokensProvider value={stubTokens}>
        <LocaleProvider
          resolver={createStaticLocaleResolver({ locale: "en" })}
          fallbackBundles={[kumikoDefaultTranslations]}
        >
          <PrimitivesProvider value={defaultPrimitives}>
            <AppFeaturesProvider features={features}>
              <UserRolesProvider roles={setup.roles ?? []}>
                {setup.withNav === false ? inner : <NavProvider value={nav}>{inner}</NavProvider>}
              </UserRolesProvider>
            </AppFeaturesProvider>
          </PrimitivesProvider>
        </LocaleProvider>
      </TokensProvider>
    );
  }
  return Object.assign(render(ui, { wrapper: Wrapper }), { nav });
}

const entity = {
  fields: {
    name: { type: "text" },
    owner: { type: "reference", entity: "owner", labelField: "displayName" },
  },
} as unknown as EntityDefinition;

const screen: EntityListScreenDefinition = {
  id: "",
  type: "entityList",
  entity: "dog",
  columns: [{ field: "name" }, { field: "owner" }],
};

const ownerFirstScreen: EntityListScreenDefinition = {
  ...screen,
  columns: [{ field: "owner" }, { field: "name" }],
};

const resolvedRow = {
  id: "r1",
  name: "Rex",
  owner: OWNER_ID,
  _refs: { owner: { id: OWNER_ID, displayName: "Ada" } },
};

function list(
  rows: readonly Record<string, unknown>[],
  options: {
    readonly screen?: EntityListScreenDefinition;
    readonly onRowClick?: () => void;
  } = {},
): ReactElement {
  return (
    <RenderList
      screen={options.screen ?? screen}
      entity={entity}
      rows={rows}
      featureName="people"
      {...(options.onRowClick !== undefined && { onRowClick: options.onRowClick })}
    />
  );
}

async function renderSettled(
  ui: ReactElement,
  setup: Setup = {},
): Promise<ReturnType<typeof renderWith>> {
  const view = renderWith(ui, setup);
  await act(async () => {});
  return view;
}

describe("reference column links", async () => {
  test("a resolved reference links to the detail page of the referenced record", async () => {
    const view = await renderSettled(list([resolvedRow]));
    const anchor = view.getByTestId("cell-r1-owner").querySelector("a");
    expect(anchor?.getAttribute("href")).toBe(`/owner-detail/${OWNER_ID}`);
  });

  test("a plain click navigates in-app and does not trigger the row click", async () => {
    const onRowClick = mock();
    const view = await renderSettled(list([resolvedRow], { onRowClick }));
    const anchor = view.getByTestId("cell-r1-owner").querySelector("a");
    if (anchor === null) throw new Error("expected a link in the reference cell");
    fireEvent.click(anchor);
    expect(view.nav.navigate).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("a modified click keeps the browser default and does not navigate", async () => {
    const onRowClick = mock();
    const view = await renderSettled(list([resolvedRow], { onRowClick }));
    const anchor = view.getByTestId("cell-r1-owner").querySelector("a");
    if (anchor === null) throw new Error("expected a link in the reference cell");
    fireEvent.click(anchor, { ctrlKey: true });
    expect(view.nav.navigate).not.toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("the first cell of a clickable row stays text, a link would nest in its button", async () => {
    const view = await renderSettled(
      list([resolvedRow], { screen: ownerFirstScreen, onRowClick: mock() }),
    );
    expect(view.getByTestId("cell-r1-owner").querySelector("a")).toBeNull();
  });

  test.each([
    ["the entity has no detail screen", { features: [noDetailFeature] }],
    ["no feature list exists, so hrefFor throws", { features: [] }],
    [
      "the user lacks a role of the detail screen",
      {
        features: [featureWith({ roles: ["Admin"] })],
        roles: ["User"],
      },
    ],
    ["no nav provider is mounted", { withNav: false }],
  ] as const)("no link when %s", async (_, setup) => {
    const view = await renderSettled(list([resolvedRow]), setup);
    const cell = view.getByTestId("cell-r1-owner");
    expect(cell.textContent).toBe("Ada");
    expect(cell.querySelector("a")).toBeNull();
  });

  test("a role of the detail screen grants the link", async () => {
    const view = await renderSettled(list([resolvedRow]), {
      features: [featureWith({ roles: ["Admin"] })],
      roles: ["Admin"],
    });
    expect(view.getByTestId("cell-r1-owner").querySelector("a")).not.toBeNull();
  });

  test("an id the user cannot resolve stays text", async () => {
    const view = await renderSettled(list([{ id: "r1", name: "Rex", owner: OTHER_OWNER_ID }]));
    await waitFor(() => expect(view.getByTestId("cell-r1-owner").textContent).toBe(OTHER_OWNER_ID));
    expect(view.getByTestId("cell-r1-owner").querySelector("a")).toBeNull();
  });

  test("a null _refs entry for the field stays text", async () => {
    const view = await renderSettled(
      list([{ id: "r1", name: "Rex", owner: OTHER_OWNER_ID, _refs: { owner: null } }]),
    );
    await waitFor(() => expect(view.getByTestId("cell-r1-owner").textContent).toBe(OTHER_OWNER_ID));
    expect(view.getByTestId("cell-r1-owner").querySelector("a")).toBeNull();
  });
});

const detailEntity = {
  fields: {
    owner: { type: "reference", entity: "owner", labelField: "displayName" },
    guests: { type: "reference", entity: "owner", labelField: "displayName", multiple: true },
  },
} as unknown as EntityDefinition;

const detailScreen: EntityEditScreenDefinition = {
  id: "dog-edit",
  type: "entityEdit",
  entity: "dog",
  layout: {
    sections: [
      {
        fields: [
          { field: "owner", readOnly: true },
          { field: "guests", readOnly: true },
        ],
      },
    ],
  },
};

const ownerRows = [
  { id: OWNER_ID, displayName: "Ada" },
  { id: OTHER_OWNER_ID, displayName: "Grace" },
];

function detail(initial: Record<string, unknown>, setup: Setup = {}) {
  const dispatcher = createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: ownerRows },
    })) as unknown as Dispatcher["query"],
  });
  return renderWith(
    <RenderEdit
      screen={detailScreen}
      entity={detailEntity}
      featureName="people"
      initial={initial}
      customSubmit={async () => ({ isSuccess: true, validationBlocked: false, data: undefined })}
      valueDisplay="text"
    />,
    { dispatcher, ...setup },
  );
}

describe("reference field links", () => {
  test("a resolved reference links to the referenced record, keeping the field testId", async () => {
    const view = detail({ owner: OWNER_ID });
    await waitFor(() => expect(view.getByTestId("field-value-owner").textContent).toBe("Ada"));
    const anchor = view.getByTestId("field-value-owner").querySelector("a");
    expect(anchor?.getAttribute("href")).toBe(`/owner-detail/${OWNER_ID}`);
  });

  test("a multi-reference renders one link per resolved label", async () => {
    const view = detail({ guests: [OWNER_ID, OTHER_OWNER_ID, "gone"] });
    await waitFor(() =>
      expect(view.getByTestId("field-value-guests").textContent).toBe("Ada, Grace, gone"),
    );
    const anchors = view.getByTestId("field-value-guests").querySelectorAll("a");
    expect([...anchors].map((a) => a.getAttribute("href"))).toEqual([
      `/owner-detail/${OWNER_ID}`,
      `/owner-detail/${OTHER_OWNER_ID}`,
    ]);
  });

  test("an unresolved id stays text", async () => {
    const view = detail({ owner: "gone" });
    await waitFor(() => expect(view.getByTestId("field-value-owner").textContent).toBe("gone"));
    expect(view.getByTestId("field-value-owner").querySelector("a")).toBeNull();
  });

  test.each([
    ["the entity has no detail screen", { features: [noDetailFeature] }],
    [
      "the user lacks a role of the detail screen",
      {
        features: [featureWith({ roles: ["Admin"] })],
        roles: ["User"],
      },
    ],
    ["no nav provider is mounted", { withNav: false }],
  ] as const)("no link when %s", async (_, setup) => {
    const view = detail({ owner: OWNER_ID }, setup);
    await waitFor(() => expect(view.getByTestId("field-value-owner").textContent).toBe("Ada"));
    expect(view.getByTestId("field-value-owner").querySelector("a")).toBeNull();
  });
});
