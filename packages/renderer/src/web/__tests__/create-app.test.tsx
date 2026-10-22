import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  DashboardScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useSyncExternalStore } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import type {
  AppSchema,
  ColumnRendererProps,
  ContentEditorProps,
  FeatureSchema,
  NavApi,
} from "../../index.ts";
import {
  createStaticLocaleResolver,
  toAppSchema,
  UserRolesProvider,
  useContentEditor,
} from "../../index.ts";
import { APP_SCHEMA_API_PATH } from "../app/app-schema-boot.tsx";
import type { ClientFeatureDefinition } from "../app/client-plugin.tsx";
import { type CreateKumikoAppOptions, createKumikoApp } from "../app/create-app.tsx";
import { createMockDispatcher } from "./test-utils.tsx";

const taskEntity = {
  fields: {
    title: { type: "text", required: true },
  },
} as unknown as EntityDefinition;

const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: { sections: [{ title: "x", fields: ["title"] }] },
};

const listScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title"],
};

function makeDispatcher(): Dispatcher {
  return createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], nextCursor: null },
    })) as unknown as Dispatcher["query"],
  });
}

function mountRoot(id = "root"): HTMLDivElement {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const root = document.createElement("div");
  root.id = id;
  document.body.appendChild(root);
  return root as HTMLDivElement;
}

const baseSchema: FeatureSchema = {
  featureName: "tasks",
  entities: { task: taskEntity },
  screens: [editScreen, listScreen],
  navs: [{ id: "task-edit", label: "tasks:nav.task-edit", screen: "tasks:screen:task-edit" }],
};

// createKumikoApp calls createRoot(...).render(...) directly; React 18+
// batches this in a concurrent render phase whose state updates React flags
// as "outside act()" in test mode. Production code should not need to know
// about act(); the test wraps the only test-owned call site. async is needed
// to flush the first useEffect tick in KumikoScreen (useQuery) as well.
let appRoot: { unmount: () => void } | undefined;

async function mountApp(options: CreateKumikoAppOptions): Promise<void> {
  await act(async () => {
    const result = createKumikoApp(options);
    appRoot = result.root;
  });
}

describe("createKumikoApp", () => {
  // createKumikoApp mounts via createRoot into document.body. Reset
  // between tests: unmount the React root so pending effects cannot leak into
  // subsequent tests, then clear the body.
  afterEach(() => {
    if (appRoot !== undefined) {
      act(() => {
        // biome-ignore lint/style/noNonNullAssertion: TS can't narrow inside act() callback
        appRoot!.unmount();
      });
      appRoot = undefined;
    }
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  afterAll(() => {
    if (appRoot !== undefined) {
      act(() => {
        // biome-ignore lint/style/noNonNullAssertion: TS can't narrow inside act() callback
        appRoot!.unmount();
      });
      appRoot = undefined;
    }
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("mounts into #root and renders the first screen by default", async () => {
    mountRoot();
    await mountApp({ schema: baseSchema, dispatcher: makeDispatcher() });
    // First screen is entityEdit → form with the title field.
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    expect(screen.getByTestId("field-title")).toBeTruthy();
  });

  test("screenWidth option reaches the form shell; without it the shell keeps max-w-4xl", async () => {
    // fillHeight:false keeps the card layout, whose shell is FormScreenShell
    // (the default screen-form layout has its own fixed column).
    const cardSchema: FeatureSchema = {
      ...baseSchema,
      screens: [{ ...editScreen, fillHeight: false }, listScreen],
    };
    const shellOf = () => screen.getByTestId("render-edit-form").firstElementChild as HTMLElement;

    mountRoot();
    await mountApp({ schema: cardSchema, dispatcher: makeDispatcher(), screenWidth: "full" });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    expect(shellOf().className).toContain("max-w-full");
    expect(shellOf().className).not.toContain("max-w-4xl");

    act(() => {
      appRoot?.unmount();
    });
    appRoot = undefined;
    document.body.replaceChildren();

    mountRoot();
    await mountApp({ schema: cardSchema, dispatcher: makeDispatcher() });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    expect(shellOf().className).toContain("max-w-4xl");
  });

  test("screenQn override: mounts the named screen instead of the first", async () => {
    mountRoot();
    await mountApp({
      schema: baseSchema,
      dispatcher: makeDispatcher(),
      screenQn: "tasks:screen:task-list",
    });
    // findBy* retries for the default timeout — lets the async useQuery
    // settle without us fishing for intermediate loading state.
    expect(await screen.findByTestId("render-list-table-empty")).toBeTruthy();
  });

  // Per-role projected schemas can legitimately omit
  // a screen a stale URL/deep-link still points at — pins the pre-existing
  // localized empty state rather than a crash or a raw QN banner.
  test("screenQn pointing at a screen absent from the schema → unavailable empty state", async () => {
    mountRoot();
    await mountApp({
      schema: baseSchema,
      dispatcher: makeDispatcher(),
      screenQn: "tasks:screen:does-not-exist",
    });
    expect(await screen.findByTestId("kumiko-screen-not-found")).toBeTruthy();
    expect(screen.queryByText(/does-not-exist/)).toBeNull();
  });

  test("route to an unknown screen id → unavailable empty state without a wrong QN, home button navigates to landing", async () => {
    mountRoot();
    const navigate = mock((_target: unknown) => {});
    const memoryNav: NavApi = {
      route: { screenId: "releases" },
      navigate,
      replace: () => {},
      hrefFor: () => "",
      searchParams: {},
      setSearchParams: () => {},
    };
    await mountApp({
      schema: baseSchema,
      dispatcher: makeDispatcher(),
      navAdapter: () => memoryNav,
    });
    expect(await screen.findByTestId("kumiko-screen-not-found")).toBeTruthy();
    expect(screen.queryByText(/Screen not found/)).toBeNull();
    expect(screen.queryByText(/tasks:screen:releases/)).toBeNull();
    fireEvent.click(screen.getByTestId("kumiko-screen-not-found-home"));
    expect(navigate).toHaveBeenCalledWith({ screenId: "task-edit" });
  });

  test("rootId override: mounts into a different DOM id", async () => {
    mountRoot("custom-root");
    await mountApp({
      schema: baseSchema,
      rootId: "custom-root",
      dispatcher: makeDispatcher(),
    });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    // And the default #root doesn't pick anything up.
    expect(document.getElementById("root")).toBeNull();
  });

  test("missing #root → throws with a helpful message", () => {
    // No DOM node prepped.
    expect(() => createKumikoApp({ schema: baseSchema, dispatcher: makeDispatcher() })).toThrow(
      /#root not found/,
    );
  });

  test("empty schema.screens → throws (nothing to render)", () => {
    mountRoot();
    const empty: FeatureSchema = { ...baseSchema, screens: [] };
    expect(() => createKumikoApp({ schema: empty, dispatcher: makeDispatcher() })).toThrow(
      /no screens/,
    );
  });

  test("fallback screen skips access-restricted screens across features (#1176)", async () => {
    mountRoot();
    const restrictedFeature: FeatureSchema = {
      featureName: "user",
      entities: { task: taskEntity },
      screens: [{ ...listScreen, id: "user-list", access: { roles: ["SystemAdmin"] } }],
    };
    const openFeature: FeatureSchema = { ...baseSchema, featureName: "tasks" };
    const schema: AppSchema = { features: [restrictedFeature, openFeature] };
    await mountApp({ schema, dispatcher: makeDispatcher() });
    // Landing on user-list (SystemAdmin-only) would show an access-denied
    // banner instead — the tasks:task-edit form must win instead.
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
  });

  test("fallback screen: an openToAll screen counts as accessible", async () => {
    mountRoot();
    const restrictedFeature: FeatureSchema = {
      featureName: "user",
      entities: { task: taskEntity },
      screens: [{ ...editScreen, id: "user-edit", access: { roles: ["SystemAdmin"] } }],
    };
    const openFeature: FeatureSchema = {
      featureName: "tasks",
      entities: { task: taskEntity },
      screens: [
        {
          ...listScreen,
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        },
      ],
      navs: [{ id: "task-list", label: "tasks:nav.task-list", screen: "tasks:screen:task-list" }],
    };
    const schema: AppSchema = { features: [restrictedFeature, openFeature] };
    await mountApp({ schema, dispatcher: makeDispatcher() });
    expect(await screen.findByTestId("render-list-table-empty")).toBeTruthy();
  });

  test("all screens access-restricted → throws (no accessible fallback)", () => {
    mountRoot();
    const restrictedOnly: AppSchema = {
      features: [
        {
          featureName: "user",
          entities: { task: taskEntity },
          screens: [{ ...editScreen, access: { roles: ["SystemAdmin"] } }],
        },
      ],
    };
    expect(() => createKumikoApp({ schema: restrictedOnly, dispatcher: makeDispatcher() })).toThrow(
      /no screens/,
    );
  });

  test("custom screen without a registered clientFeatures component → console.error names feature + screen at boot (kumiko-framework#2025)", async () => {
    // A server feature can declare a `type: "custom"` screen without the
    // app mounting the corresponding client plugin — the screen is still
    // reachable via URL. createKumikoApp should surface that visibly ONCE
    // at boot instead of only showing it as a banner when the URL is
    // opened (which nobody would see if they never visit the route).
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const customScreenSchema: FeatureSchema = {
      featureName: "delivery",
      entities: { task: taskEntity },
      screens: [
        {
          id: "delivery-log",
          type: "custom",
          renderer: { react: { __component: "DeliveryLog" } },
        },
      ],
    };

    mountRoot();
    await mountApp({
      schema: customScreenSchema,
      dispatcher: makeDispatcher(),
      screenQn: "delivery:screen:delivery-log",
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("delivery:delivery-log"));

    errorSpy.mockRestore();
  });

  test("custom screen WITH a registered clientFeatures component → no boot diagnostic", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    function DeliveryLog(): ReactNode {
      return <span data-testid="delivery-log-mounted" />;
    }
    const customScreenSchema: FeatureSchema = {
      featureName: "delivery",
      entities: { task: taskEntity },
      screens: [
        {
          id: "delivery-log",
          type: "custom",
          renderer: { react: { __component: "DeliveryLog" } },
        },
      ],
    };

    mountRoot();
    await mountApp({
      schema: customScreenSchema,
      dispatcher: makeDispatcher(),
      screenQn: "delivery:screen:delivery-log",
      clientFeatures: [{ name: "delivery", components: { "delivery-log": DeliveryLog } }],
    });

    expect(await screen.findByTestId("delivery-log-mounted")).toBeTruthy();
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("delivery:delivery-log"));

    errorSpy.mockRestore();
  });

  test("dormant custom screen without a registered clientFeatures component → no boot diagnostic (kumiko-framework#2034)", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const dormantScreenSchema: FeatureSchema = {
      featureName: "user-data-rights",
      entities: { task: taskEntity },
      screens: [
        {
          id: "privacy-center",
          type: "custom",
          renderer: { react: { __component: "PrivacyCenterScreen" } },
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
          dormant: true,
        },
      ],
    };

    mountRoot();
    await mountApp({
      schema: dormantScreenSchema,
      dispatcher: makeDispatcher(),
      screenQn: "user-data-rights:screen:privacy-center",
    });

    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("privacy-center"));

    errorSpy.mockRestore();
  });

  test("clientFeatures.columnRenderers → bei Key-Kollision warnt + last-wins gewinnt", async () => {
    // Two features provide the same renderer key; the merge in create-app warns
    // and keeps the later entry (last wins). This verifies that the intentional
    // override behavior does not silently change if someone refactors it to
    // "first-wins".
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    function FirstSwatch({ value }: ColumnRendererProps): ReactNode {
      return <span data-testid="ca-first">{String(value)}</span>;
    }
    function SecondSwatch({ value }: ColumnRendererProps): ReactNode {
      return <span data-testid="ca-second">{String(value)}</span>;
    }
    const colorEntity = {
      fields: { color: { type: "text" } },
    } as unknown as EntityDefinition;
    const conflictSchema: FeatureSchema = {
      featureName: "tasks",
      entities: { task: colorEntity },
      screens: [
        {
          id: "color-list",
          type: "entityList",
          entity: "task",
          columns: [{ field: "color", renderer: { react: { __component: "Swatch" } } }],
        },
      ],
      navs: [
        { id: "color-list", label: "tasks:nav.color-list", screen: "tasks:screen:color-list" },
      ],
    };

    mountRoot();
    await mountApp({
      schema: conflictSchema,
      dispatcher: createMockDispatcher({
        query: (async () => ({
          isSuccess: true,
          data: { rows: [{ id: "r1", color: "#ddd" }], nextCursor: null },
        })) as unknown as Dispatcher["query"],
      }),
      clientFeatures: [
        { name: "first", columnRenderers: { Swatch: FirstSwatch } },
        { name: "second", columnRenderers: { Swatch: SecondSwatch } },
      ],
    });

    // Last wins: SecondSwatch is mounted, while FirstSwatch is not.
    expect(await screen.findByTestId("ca-second")).toBeTruthy();
    expect(screen.queryByTestId("ca-first")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('columnRenderer "Swatch" defined by multiple clientFeatures'),
    );

    warnSpy.mockRestore();
  });

  test("clientFeatures.columnRenderers → __component-Renderer mounten echtes Component im DOM", async () => {
    // Verifies the end-to-end wiring: ClientFeatureDefinition.columnRenderers
    // → provider in create-app → useColumnRenderer in the DataTable cell → JSX
    // in the DOM. The schema declares the string form; the component exists only
    // on the client.
    function Swatch({ value, column }: ColumnRendererProps): ReactNode {
      return (
        <span data-testid="ca-swatch">
          <span data-testid="ca-swatch-value">{String(value)}</span>
          <span data-testid="ca-swatch-field">{column.field}</span>
        </span>
      );
    }
    const colorEntity = {
      fields: { title: { type: "text" }, color: { type: "text" } },
    } as unknown as EntityDefinition;
    const colorListScreen: EntityListScreenDefinition = {
      id: "color-list",
      type: "entityList",
      entity: "task",
      columns: ["title", { field: "color", renderer: { react: { __component: "Swatch" } } }],
    };
    const colorSchema: FeatureSchema = {
      featureName: "tasks",
      entities: { task: colorEntity },
      screens: [colorListScreen],
      navs: [
        { id: "color-list", label: "tasks:nav.color-list", screen: "tasks:screen:color-list" },
      ],
    };
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ id: "r1", title: "Alpha", color: "#a1b2c3" }], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    const clientFeature: ClientFeatureDefinition = {
      name: "tasks",
      columnRenderers: { Swatch },
    };

    mountRoot();
    await mountApp({
      schema: colorSchema,
      dispatcher,
      clientFeatures: [clientFeature],
    });

    expect(await screen.findByTestId("ca-swatch")).toBeTruthy();
    expect(screen.getByTestId("ca-swatch-value").textContent).toBe("#a1b2c3");
    expect(screen.getByTestId("ca-swatch-field").textContent).toBe("color");
  });

  test("clientFeatures.contentEditors → createKumikoApp wires merge → provider → useContentEditor end-to-end", async () => {
    // Proves the whole chain: ClientFeatureDefinition.contentEditors →
    // mergeContentEditors → ContentEditorsProvider in the tree →
    // useContentEditor in the consumer. Without the provider mount,
    // useContentEditor would always fall back to the textarea — this test
    // would fail then.
    function RichEditor({ value }: ContentEditorProps): ReactNode {
      return <div data-testid="ca-rich-editor">{value}</div>;
    }
    function EditorProbe(): ReactNode {
      const Editor = useContentEditor("rich");
      return (
        <Editor
          id="ca-rich-editor-probe"
          value="hello"
          onChange={() => {}}
          variables={[]}
          readOnly={false}
        />
      );
    }
    const probeSchema: FeatureSchema = {
      featureName: "tasks",
      entities: {},
      screens: [{ id: "editor-probe", type: "custom", renderer: {} }],
      navs: [
        {
          id: "editor-probe",
          label: "tasks:nav.editor-probe",
          screen: "tasks:screen:editor-probe",
        },
      ],
    };
    const clientFeature: ClientFeatureDefinition = {
      name: "tasks",
      components: { "editor-probe": EditorProbe },
      contentEditors: { rich: RichEditor },
    };

    mountRoot();
    await mountApp({
      schema: probeSchema,
      dispatcher: makeDispatcher(),
      clientFeatures: [clientFeature],
    });

    expect(await screen.findByTestId("ca-rich-editor")).toBeTruthy();
    expect(screen.getByTestId("ca-rich-editor").textContent).toBe("hello");
  });

  test("schema.translations (r.translations, #1059) resolves nav/dashboard labels without any clientFeatures duplication", async () => {
    // Mirrors cap-counter's real shape: a feature that declares r.translations
    // for its own nav label but ships NO web/i18n.ts / clientFeatures entry at
    // all. Previously this label rendered as the raw i18n key forever.
    const dashboardScreen: DashboardScreenDefinition = {
      id: "overview",
      type: "dashboard",
      panels: [
        {
          kind: "stat",
          id: "cap-list",
          label: "cap-counter:nav.cap-list",
          query: "cap-counter:query:stat",
          valueField: "value",
        },
      ],
    };
    const schema: FeatureSchema = {
      featureName: "cap-counter",
      entities: {},
      screens: [dashboardScreen],
      navs: [
        {
          id: "overview",
          label: "cap-counter:nav.cap-list",
          screen: "cap-counter:screen:overview",
        },
      ],
      translations: {
        "cap-counter:nav.cap-list": { de: "Limits", en: "Caps" },
      },
    };
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { value: "3" },
      })) as unknown as Dispatcher["query"],
    });

    mountRoot();
    await mountApp({
      schema,
      dispatcher,
      locale: createStaticLocaleResolver({ locale: "en" }),
    });

    await waitFor(() => expect(screen.getByText("Caps")).toBeTruthy());
    expect(screen.queryByText("cap-counter:nav.cap-list")).toBeNull();
  });

  test("clientFeatures.translations still overrides schema.translations for the same key (precedence)", async () => {
    // The app override must also win over a framework-provided label; otherwise
    // an app could no longer customize a bundled feature's label once its
    // r.translations are supplied automatically.
    const dashboardScreen: DashboardScreenDefinition = {
      id: "overview",
      type: "dashboard",
      panels: [
        {
          kind: "stat",
          id: "cap-list",
          label: "cap-counter:nav.cap-list",
          query: "cap-counter:query:stat",
          valueField: "value",
        },
      ],
    };
    const schema: FeatureSchema = {
      featureName: "cap-counter",
      entities: {},
      screens: [dashboardScreen],
      navs: [
        {
          id: "overview",
          label: "cap-counter:nav.cap-list",
          screen: "cap-counter:screen:overview",
        },
      ],
      translations: {
        "cap-counter:nav.cap-list": { de: "Limits", en: "Caps" },
      },
    };
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { value: "3" },
      })) as unknown as Dispatcher["query"],
    });
    const override: ClientFeatureDefinition = {
      name: "cap-counter-app-override",
      translations: {
        en: { "cap-counter:nav.cap-list": "Quota" },
      },
    };

    mountRoot();
    await mountApp({
      schema,
      dispatcher,
      clientFeatures: [override],
      locale: createStaticLocaleResolver({ locale: "en" }),
    });

    await waitFor(() => expect(screen.getByText("Quota")).toBeTruthy());
    expect(screen.queryByText("Caps")).toBeNull();
  });

  test("navAdapter override: eigener Router steuert den aktiven Screen", async () => {
    // Verifies the navigation seam: the default adapter reads location.pathname,
    // while this memory adapter hardcodes the route. If the swap works, we see
    // the list screen instead of the form screen without setting `screenQn` or
    // touching `window.history`.
    mountRoot();
    const memoryNav: NavApi = {
      route: { screenId: "task-list" },
      navigate: () => {},
      replace: () => {},
      hrefFor: (target) => {
        if (!("screenId" in target)) return "";
        return target.entityId !== undefined
          ? `/${target.screenId}/${target.entityId}`
          : `/${target.screenId}`;
      },
      searchParams: {},
      setSearchParams: () => {},
    };
    await mountApp({
      schema: baseSchema,
      dispatcher: makeDispatcher(),
      navAdapter: () => memoryNav,
    });
    expect(await screen.findByTestId("render-list-table-empty")).toBeTruthy();
    // And definitely not the edit screen, which would be the default landing.
    expect(screen.queryByTestId("render-edit-form")).toBeNull();
  });

  // Default row-click target. A screen declaring `detailFor` for the
  // entity is the "record" — the click should land there without anyone
  // wiring rowActions/onRowClick, and it should win over both of the old
  // defaults (entityEdit-search, app-wide onRowClick).
  describe("default row click (fw#2164)", () => {
    const taskDetailScreen: ScreenDefinition = {
      id: "task-detail",
      type: "custom",
      detailFor: "task",
      renderer: { react: { __component: "TaskDetail" } },
    };

    function TaskDetailStub(): ReactNode {
      return <span data-testid="task-detail-mounted" />;
    }

    function makeRowDispatcher(): Dispatcher {
      return createMockDispatcher({
        query: (async () => ({
          isSuccess: true,
          data: { rows: [{ id: "r1", title: "Alpha" }], nextCursor: null },
        })) as unknown as Dispatcher["query"],
      });
    }

    test("declared detailFor screen wins over the entityEdit-search fallback", async () => {
      window.history.replaceState(null, "", "/task-list");
      mountRoot();
      const schema: FeatureSchema = {
        featureName: "tasks",
        entities: { task: taskEntity },
        screens: [editScreen, listScreen, taskDetailScreen],
      };
      await mountApp({
        schema,
        dispatcher: makeRowDispatcher(),
        screenQn: "tasks:screen:task-list",
        clientFeatures: [{ name: "tasks", components: { "task-detail": TaskDetailStub } }],
      });
      await waitFor(() => expect(screen.getByTestId("row-r1")).toBeTruthy());

      fireEvent.click(screen.getByTestId("row-r1"));

      await waitFor(() => expect(window.location.pathname).toBe("/task-detail/r1"));
      expect(await screen.findByTestId("task-detail-mounted")).toBeTruthy();
      expect(new URLSearchParams(window.location.search).get("returnTo")).toBe("task-list");
    });

    test("no detailFor screen → unchanged fallback to the entity's entityEdit screen", async () => {
      window.history.replaceState(null, "", "/task-list");
      mountRoot();
      await mountApp({
        schema: baseSchema,
        dispatcher: makeRowDispatcher(),
        screenQn: "tasks:screen:task-list",
      });
      await waitFor(() => expect(screen.getByTestId("row-r1")).toBeTruthy());

      fireEvent.click(screen.getByTestId("row-r1"));

      await waitFor(() => expect(window.location.pathname).toBe("/task-edit/r1"));
    });

    test("declared detailFor screen wins even over an app-wide onRowClick option", async () => {
      window.history.replaceState(null, "", "/task-list");
      mountRoot();
      const schema: FeatureSchema = {
        featureName: "tasks",
        entities: { task: taskEntity },
        screens: [listScreen, taskDetailScreen],
      };
      const onRowClick = () => {
        throw new Error("onRowClick must not fire when a detailFor screen resolves");
      };
      await mountApp({
        schema,
        dispatcher: makeRowDispatcher(),
        screenQn: "tasks:screen:task-list",
        onRowClick,
        clientFeatures: [{ name: "tasks", components: { "task-detail": TaskDetailStub } }],
      });
      await waitFor(() => expect(screen.getByTestId("row-r1")).toBeTruthy());

      fireEvent.click(screen.getByTestId("row-r1"));

      await waitFor(() => expect(window.location.pathname).toBe("/task-detail/r1"));
    });

    // A list screen with no reachable click target must not look
    // clickable either — the click handler was always defined before,
    // silently no-op-ing on click. Row-testids stay independent of the
    // handler (see primitives/index.tsx), so getByTestId still finds them.
    test("no detailFor screen and no entityEdit screen → no row-click handler, row not clickable", async () => {
      window.history.replaceState(null, "", "/task-list");
      mountRoot();
      const schema: FeatureSchema = {
        featureName: "tasks",
        entities: { task: taskEntity },
        screens: [listScreen],
      };
      await mountApp({
        schema,
        dispatcher: makeRowDispatcher(),
        screenQn: "tasks:screen:task-list",
      });
      await waitFor(() => expect(screen.getByTestId("row-r1")).toBeTruthy());

      const row = screen.getByTestId("row-r1");
      expect(row.className).not.toContain("cursor-pointer");

      fireEvent.click(row);

      // No target exists — the click must not navigate anywhere.
      expect(window.location.pathname).toBe("/task-list");
    });

    test("entityEdit screen for the entity → row-click handler present, row looks clickable", async () => {
      window.history.replaceState(null, "", "/task-list");
      mountRoot();
      await mountApp({
        schema: baseSchema,
        dispatcher: makeRowDispatcher(),
        screenQn: "tasks:screen:task-list",
      });
      await waitFor(() => expect(screen.getByTestId("row-r1")).toBeTruthy());

      expect(screen.getByTestId("row-r1").className).toContain("cursor-pointer");
    });
  });

  // Without an explicit `schema`, createKumikoApp
  // fetches it from the authenticated GET /api/schema instead of throwing
  // at boot — these tests exercise the loading/unauthorized/failed states
  // and the "gate first, fetch after" ordering.
  describe("createKumikoApp — schema fetch (kumiko-framework#3314)", () => {
    const originalFetch = globalThis.fetch;
    let calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];

    function mockFetch(
      onSchema: (call: {
        readonly url: string;
        readonly init?: RequestInit;
      }) => Promise<Response> | Response,
    ): void {
      globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push({ url, init });
        if (url.endsWith(APP_SCHEMA_API_PATH)) return onSchema({ url, init });
        return new Response(null, { status: 404 });
      }) as unknown as typeof globalThis.fetch;
    }

    function schemaCalls(): Array<{ readonly url: string; readonly init?: RequestInit }> {
      return calls.filter((c) => c.url.endsWith(APP_SCHEMA_API_PATH));
    }

    afterEach(() => {
      globalThis.fetch = originalFetch;
      calls = [];
      const w = window as unknown as { __KUMIKO_SCHEMA__?: unknown };
      delete w.__KUMIKO_SCHEMA__;
    });

    test("explicit schema → fetch is never called", async () => {
      mountRoot();
      mockFetch(() => new Response(JSON.stringify(toAppSchema(baseSchema)), { status: 200 }));
      await mountApp({ schema: baseSchema, dispatcher: makeDispatcher() });
      await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
      expect(schemaCalls().length).toBe(0);
    });

    test("no schema/global set → fetches GET /api/schema with same-origin credentials; 200 renders the first screen", async () => {
      mountRoot();
      mockFetch(() => new Response(JSON.stringify(toAppSchema(baseSchema)), { status: 200 }));
      await mountApp({ dispatcher: makeDispatcher() });
      await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
      expect(schemaCalls().length).toBe(1);
      expect(schemaCalls()[0]?.url).toBe(APP_SCHEMA_API_PATH);
      expect(schemaCalls()[0]?.init?.credentials).toBe("same-origin");
    });

    test("schemaUrl with a cross-origin base → fetches that URL with include credentials", async () => {
      mountRoot();
      mockFetch(() => new Response(JSON.stringify(toAppSchema(baseSchema)), { status: 200 }));
      const schemaUrl = `https://api.example.com${APP_SCHEMA_API_PATH}`;
      await mountApp({ dispatcher: makeDispatcher(), schemaUrl });
      await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
      expect(schemaCalls().length).toBe(1);
      expect(schemaCalls()[0]?.url).toBe(schemaUrl);
      expect(schemaCalls()[0]?.init?.credentials).toBe("include");
    });

    test("fetch → 401 → unauthorized text, no throw, exactly one fetch even after further updates", async () => {
      mountRoot();
      mockFetch(() => new Response(null, { status: 401 }));
      await mountApp({ dispatcher: makeDispatcher() });
      await waitFor(() =>
        expect(screen.getByText("You need to sign in to see this.")).toBeTruthy(),
      );
      expect(schemaCalls().length).toBe(1);
      // A later, unrelated update must not re-trigger the fetch (no
      // accidental retry loop from an effect keyed on the wrong deps).
      await act(async () => {});
      expect(schemaCalls().length).toBe(1);
    });

    test("fetch rejected (network error) → error text + retry; retry click refetches and renders", async () => {
      mountRoot();
      let attempts = 0;
      mockFetch(() => {
        attempts += 1;
        if (attempts === 1) throw new Error("network down");
        return new Response(JSON.stringify(toAppSchema(baseSchema)), { status: 200 });
      });
      await mountApp({ dispatcher: makeDispatcher() });
      await waitFor(() => expect(screen.getByText(/Couldn't load the app/)).toBeTruthy());
      expect(schemaCalls().length).toBe(1);

      await act(async () => {
        fireEvent.click(screen.getByText("Reload"));
      });

      await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
      expect(schemaCalls().length).toBe(2);
    });

    test("200 with an invalid payload ({}) → failed state, not a crash", async () => {
      mountRoot();
      mockFetch(() => new Response("{}", { status: 200 }));
      await mountApp({ dispatcher: makeDispatcher() });
      await waitFor(() => expect(screen.getByText(/Couldn't load the app/)).toBeTruthy());
    });

    test("200 with a schema that has no open screen → no-open-screen error, not a throw", async () => {
      mountRoot();
      const restrictedOnly: AppSchema = {
        features: [
          {
            featureName: "user",
            entities: { task: taskEntity },
            screens: [{ ...editScreen, access: { roles: ["SystemAdmin"] } }],
          },
        ],
      };
      mockFetch(() => new Response(JSON.stringify(restrictedOnly), { status: 200 }));
      await mountApp({ dispatcher: makeDispatcher() });
      await waitFor(() =>
        expect(
          screen.getByText("This app has no screen that's accessible without a role restriction."),
        ).toBeTruthy(),
      );
    });

    // GET /api/schema already projects away screens the caller's roles can't see, so a pure SystemAdmin's fetched
    // schema legitimately has ONLY role-restricted screens left — the
    // landing fallback must still find one instead of showing no-open-screen.
    test("200 with a SystemAdmin-only nav-reachable schema → renders it, no no-open-screen banner", async () => {
      mountRoot();
      const systemAdminOnly: AppSchema = {
        features: [
          {
            featureName: "admin",
            entities: { task: taskEntity },
            screens: [{ ...listScreen, id: "admin-list", access: { roles: ["SystemAdmin"] } }],
            navs: [
              {
                id: "admin-list",
                label: "admin:nav.admin-list",
                screen: "admin:screen:admin-list",
              },
            ],
          },
        ],
      };
      mockFetch(() => new Response(JSON.stringify(systemAdminOnly), { status: 200 }));
      function SystemAdminRoleProvider({ children }: { readonly children: ReactNode }): ReactNode {
        return <UserRolesProvider roles={["SystemAdmin"]}>{children}</UserRolesProvider>;
      }
      await mountApp({
        dispatcher: makeDispatcher(),
        clientFeatures: [{ name: "role-stub", providers: [SystemAdminRoleProvider] }],
      });
      expect(await screen.findByTestId("render-list-table-empty")).toBeTruthy();
      expect(
        screen.queryByText("This app has no screen that's accessible without a role restriction."),
      ).toBeNull();
    });

    test("clientFeature gate rendering a placeholder instead of children → fetch never runs", async () => {
      mountRoot();
      mockFetch(() => new Response(JSON.stringify(toAppSchema(baseSchema)), { status: 200 }));
      function LoginPlaceholderGate({
        children: _children,
      }: {
        readonly children: ReactNode;
      }): ReactNode {
        return <span data-testid="login-placeholder" />;
      }
      await mountApp({
        dispatcher: makeDispatcher(),
        clientFeatures: [{ name: "auth-stub", gates: [LoginPlaceholderGate] }],
      });
      expect(await screen.findByTestId("login-placeholder")).toBeTruthy();
      expect(schemaCalls().length).toBe(0);
    });

    function createToggleableGateStore(initial: boolean) {
      let allowed = initial;
      const listeners = new Set<() => void>();
      return {
        getSnapshot: () => allowed,
        subscribe: (onChange: () => void) => {
          listeners.add(onChange);
          return () => listeners.delete(onChange);
        },
        setAllowed: (next: boolean) => {
          allowed = next;
          for (const listener of listeners) listener();
        },
      };
    }

    test("gate withdrawing then re-admitting children refetches the schema (no stale cross-session reuse)", async () => {
      mountRoot();
      mockFetch(() => new Response(JSON.stringify(toAppSchema(baseSchema)), { status: 200 }));
      const gateStore = createToggleableGateStore(true);
      function ToggleableGate({ children }: { readonly children: ReactNode }): ReactNode {
        const allowed = useSyncExternalStore(gateStore.subscribe, gateStore.getSnapshot);
        return allowed ? children : <span data-testid="gate-closed" />;
      }
      await mountApp({
        dispatcher: makeDispatcher(),
        clientFeatures: [{ name: "toggle-stub", gates: [ToggleableGate] }],
      });
      await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
      expect(schemaCalls().length).toBe(1);

      await act(async () => {
        gateStore.setAllowed(false);
      });
      expect(screen.getByTestId("gate-closed")).toBeTruthy();

      await act(async () => {
        gateStore.setAllowed(true);
      });
      await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
      expect(schemaCalls().length).toBe(2);
    });
  });
});
