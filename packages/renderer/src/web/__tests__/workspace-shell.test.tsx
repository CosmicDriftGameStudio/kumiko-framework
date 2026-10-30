import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { render as _render, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { WorkspaceSchema } from "../../index.ts";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  KumikoScreen,
  LocaleProvider,
  NavProvider,
  PrimitivesProvider,
} from "../../index.ts";
import { useBrowserNavApi } from "../app/nav.tsx";
import {
  filterByAccess,
  firstNavScreenId,
  resolveDefaultId,
  WorkspaceShell,
} from "../layout/workspace-shell.tsx";
import { WorkspaceSwitcher } from "../layout/workspace-switcher.tsx";
import { defaultPrimitives } from "../primitives/index.tsx";
import { createMockDispatcher, renderWithSidebar, screen } from "./test-utils.tsx";

// Dropdown instead of a tab row (see workspace-switcher.tsx) — the
// trigger always shows only the active label, Radix renders the list
// only once open. Assertions that just check "which workspace is
// active" read the trigger text instead of a per-tab aria-selected;
// only tests that need the full list or click an entry open the
// dropdown (userEvent, Radix reacts to pointerdown).
function activeWorkspaceLabel(): string | null {
  return screen.getByTestId("workspace-switcher-trigger").textContent;
}

// jsdom shares window.history across tests in the same file. Reset to /
// before each render so URL-driven workspace state from one test doesn't
// leak into the next. Same pattern as nav.test.tsx.
beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

// Custom render wrapper: real `useBrowserNavApi` instead of test-utils'
// stub, because WorkspaceShell now reads workspace state from the nav
// route (URL-driven). The stub's no-op navigate() would freeze tab
// clicks. Workspaces-mode is on by default for these tests; the parser
// expects the first path segment to be a workspace short id.
function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: true });
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()}>
      <PrimitivesProvider value={defaultPrimitives}>
        <NavProvider value={nav}>{children}</NavProvider>
      </PrimitivesProvider>
    </LocaleProvider>
  );
}

function renderShell(ui: ReactNode): ReturnType<typeof _render> {
  return _render(ui, { wrapper: Wrapper });
}

// Build a minimal WorkspaceSchema by hand — production-side, this comes
// from a registry-builder, but the shell must work with whatever shape
// FeatureSchema.workspaces is, so test against the contract not a helper.
function ws(
  id: string,
  options: {
    label?: string;
    order?: number;
    roles?: readonly string[];
    openToAll?: boolean;
    isDefault?: boolean;
    navMembers?: readonly string[];
  } = {},
): WorkspaceSchema {
  const access = options.openToAll
    ? ({ openToAll: { reason: "test handler callable by any signed-in test user" } } as const)
    : options.roles !== undefined
      ? ({ roles: options.roles } as const)
      : undefined;
  return {
    definition: {
      id,
      label: options.label ?? id,
      ...(options.order !== undefined && { order: options.order }),
      ...(access !== undefined && { access }),
      ...(options.isDefault === true && { default: true }),
    },
    navMembers: options.navMembers ?? [],
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (no React, no providers)
// ---------------------------------------------------------------------------

describe("filterByAccess", () => {
  test("openToAll is shown to everyone", () => {
    const list = [ws("a", { openToAll: true })];
    expect(filterByAccess(list, []).map((w) => w.definition.id)).toEqual(["a"]);
  });

  test("undefined access is shown (engine convention)", () => {
    expect(filterByAccess([ws("a")], []).map((w) => w.definition.id)).toEqual(["a"]);
  });

  test("role-gated workspace shown when user has matching role", () => {
    const list = [ws("a", { roles: ["admin"] })];
    expect(filterByAccess(list, ["admin"]).map((w) => w.definition.id)).toEqual(["a"]);
  });

  test("role-gated workspace hidden when user roles don't match", () => {
    const list = [ws("a", { roles: ["admin"] })];
    expect(filterByAccess(list, ["driver"])).toHaveLength(0);
  });

  test("intersects on any-role match (OR semantics)", () => {
    const list = [ws("a", { roles: ["dispatcher", "admin"] })];
    expect(filterByAccess(list, ["dispatcher"])).toHaveLength(1);
  });

  test("sorts by order then insertion order", () => {
    const list = [
      ws("c", {
        openToAll: true,
        order: 3,
      }),
      ws("a", {
        openToAll: true,
        order: 1,
      }),
      ws("b", {
        openToAll: true,
        order: 2,
      }),
      ws("d", { openToAll: true }), // no order — sorts last
    ];
    expect(filterByAccess(list, []).map((w) => w.definition.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("resolveDefaultId", () => {
  const visible = [
    ws("admin", { openToAll: true }),
    ws("dispatch", {
      openToAll: true,
      isDefault: true,
    }),
    ws("driver", { openToAll: true }),
  ];

  test("preferred id wins when accessible", () => {
    expect(resolveDefaultId(visible, "driver")).toBe("driver");
  });

  test("preferred id ignored when not in visible set", () => {
    expect(resolveDefaultId(visible, "ghost")).toBe("dispatch");
  });

  test("default-flagged workspace picked when no preference", () => {
    expect(resolveDefaultId(visible, undefined)).toBe("dispatch");
  });

  test("first visible workspace when no default flagged", () => {
    const noDefault = [ws("a", { openToAll: true }), ws("b", { openToAll: true })];
    expect(resolveDefaultId(noDefault, undefined)).toBe("a");
  });

  test("undefined when no workspaces visible", () => {
    expect(resolveDefaultId([], undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// firstNavScreenId — Resolves a workspace's default screen.
// Pins the contracts against the production bug from 2026-05-02 (workspace-tab
// clicks landed on nav.id instead of nav.screen), plus the fallback branches.
// ---------------------------------------------------------------------------

describe("firstNavScreenId", () => {
  function appWithNavs(navs: ReadonlyArray<{ readonly id: string; readonly screen?: string }>) {
    return {
      features: [
        {
          featureName: "demo",
          entities: {},
          screens: [],
          navs: navs.map((n) => ({ id: n.id, label: n.id, ...(n.screen && { screen: n.screen }) })),
        },
      ],
    };
  }

  test("uses nav.screen, NOT nav.id (the production bug)", () => {
    const app = appWithNavs([{ id: "components", screen: "demo:screen:component-list" }]);
    expect(firstNavScreenId(app, ["demo:nav:components"])).toBe("component-list");
  });

  test("skips section headers (nav without screen) to the next member", () => {
    const app = appWithNavs([
      { id: "settings" }, // section header, no screen
      { id: "settings-branding", screen: "demo:screen:branding-settings" },
    ]);
    expect(firstNavScreenId(app, ["demo:nav:settings", "demo:nav:settings-branding"])).toBe(
      "branding-settings",
    );
  });

  test("returns '' when all members are section headers (caller MUST guard)", () => {
    const app = appWithNavs([{ id: "settings" }, { id: "more-headers" }]);
    expect(firstNavScreenId(app, ["demo:nav:settings", "demo:nav:more-headers"])).toBe("");
  });

  test("returns '' for unknown nav-QN (drift between workspace.nav and registered navs)", () => {
    const app = appWithNavs([{ id: "real", screen: "demo:screen:real" }]);
    expect(firstNavScreenId(app, ["demo:nav:ghost"])).toBe("");
  });

  test("returns '' for undefined navMembers", () => {
    expect(firstNavScreenId(appWithNavs([]), undefined)).toBe("");
  });

  test("returns '' for an empty navMembers array", () => {
    expect(firstNavScreenId(appWithNavs([]), [])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// WorkspaceSwitcher (presentational)
// ---------------------------------------------------------------------------

describe("WorkspaceSwitcher", () => {
  test("renders nothing for a single workspace (no choice = no UI)", () => {
    const { container } = renderWithSidebar(
      <WorkspaceSwitcher
        workspaces={[ws("only", { openToAll: true })]}
        activeId="only"
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="workspace-switcher-trigger"]')).toBeNull();
  });

  test("trigger shows the active workspace, dropdown lists all with aria-checked", async () => {
    const user = userEvent.setup();
    renderWithSidebar(
      <WorkspaceSwitcher
        workspaces={[
          ws("admin", {
            label: "Admin",
            openToAll: true,
          }),
          ws("driver", {
            label: "Driver",
            openToAll: true,
          }),
        ]}
        activeId="admin"
        onSelect={() => {}}
      />,
    );
    expect(activeWorkspaceLabel()).toBe("Admin");
    await user.click(screen.getByTestId("workspace-switcher-trigger"));
    expect(screen.getByTestId("workspace-tab-admin").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("workspace-tab-driver").getAttribute("aria-checked")).toBe("false");
  });

  test("clicking a dropdown entry calls onSelect with that workspace id", async () => {
    const user = userEvent.setup();
    const onSelect = mock();
    renderWithSidebar(
      <WorkspaceSwitcher
        workspaces={[
          ws("admin", {
            label: "Admin",
            openToAll: true,
          }),
          ws("driver", {
            label: "Driver",
            openToAll: true,
          }),
        ]}
        activeId="admin"
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByTestId("workspace-switcher-trigger"));
    await user.click(screen.getByTestId("workspace-tab-driver"));
    expect(onSelect).toHaveBeenCalledWith("driver");
  });
});

// ---------------------------------------------------------------------------
// WorkspaceShell (integration of switcher + nav-tree filter)
// ---------------------------------------------------------------------------

describe("WorkspaceShell", () => {
  const schema = {
    featureName: "bmc",
    entities: {},
    screens: [],
    // navs must have `screen` so firstScreenIdInWorkspace can resolve the
    // screen ID. The resolver explicitly uses nav.screen, not nav.id
    // (see the comment in workspace-shell.tsx).
    navs: [
      { id: "system", label: "System", screen: "bmc:screen:system" },
      { id: "orders", label: "Orders", screen: "bmc:screen:orders" },
      { id: "tours", label: "Tours", screen: "bmc:screen:tours" },
    ],
    workspaces: [
      ws("admin", {
        label: "Admin",
        roles: ["admin"],
        order: 1,
        isDefault: true,
        navMembers: ["bmc:nav:system", "bmc:nav:orders"],
      }),
      ws("driver", {
        label: "Driver",
        roles: ["driver"],
        order: 2,
        navMembers: ["bmc:nav:tours"],
      }),
      ws("dispatch", {
        label: "Cockpit",
        roles: ["dispatcher", "admin"],
        order: 3,
        navMembers: ["bmc:nav:orders", "bmc:nav:tours"],
      }),
    ],
  } as const;

  test("an admin sees admin + dispatch in the switcher (driver hidden)", async () => {
    const user = userEvent.setup();
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    await user.click(screen.getByTestId("workspace-switcher-trigger"));
    expect(screen.getByTestId("workspace-tab-admin")).toBeTruthy();
    expect(screen.getByTestId("workspace-tab-dispatch")).toBeTruthy();
    expect(screen.queryByTestId("workspace-tab-driver")).toBeNull();
  });

  test("default workspace (admin) is active on first render for an admin", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(activeWorkspaceLabel()).toBe("Admin");
  });

  test("only the active workspace's nav members appear in the sidebar", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    // admin → system + orders, NOT tours. getAllByText: the shadcn sidebar
    // renders both Desktop and Mobile-Sheet, so each nav entry appears twice.
    expect(screen.getAllByText("System").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Orders").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Tours").length).toBe(0);
  });

  test("clicking the dispatch tab swaps the visible nav set", async () => {
    const user = userEvent.setup();
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    await user.click(screen.getByTestId("workspace-switcher-trigger"));
    await user.click(screen.getByTestId("workspace-tab-dispatch"));
    // dispatch → orders + tours, NOT system (getAllByText: Desktop + Mobile-Sheet)
    expect(screen.getAllByText("Orders").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tours").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("System").length).toBe(0);
  });

  test("a driver lands on the driver workspace (their only one)", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u2", roles: ["driver"] }}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    // Only one workspace → switcher renders nothing, but the nav still
    // shows that workspace's members.
    expect(screen.queryByTestId("workspace-tab-driver")).toBeNull();
    expect(screen.getAllByText("Tours").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("System").length).toBe(0);
    expect(screen.queryAllByText("Orders").length).toBe(0);
  });

  test("schema without workspaces falls back to plain rendering (all navs visible)", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={{ ...schema, workspaces: undefined }}
        user={{ id: "u1", roles: ["admin"] }}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    // No allow-set → NavTree renders every entry.
    expect(screen.getByText("System")).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("Tours")).toBeTruthy();
    // No switcher.
    expect(document.querySelector('[data-kumiko-layout="workspace-switcher"]')).toBeNull();
  });

  test("initialWorkspaceId picks a non-default workspace at mount", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
        initialWorkspaceId="dispatch"
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(activeWorkspaceLabel()).toBe("Cockpit");
  });

  // Security regression — without the empty-allow-set branch, the NavTree
  // would fall back to "no filter" and leak admin nav items to a user
  // that has zero accessible workspaces.
  test("user with no accessible workspace sees an empty sidebar (not all navs)", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u3", roles: ["nobody"] }}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(screen.queryByText("System")).toBeNull();
    expect(screen.queryByText("Orders")).toBeNull();
    expect(screen.queryByText("Tours")).toBeNull();
  });

  test("fill defaults to true: applies h-svh on root and min-h-0 on inset/main", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    const root = document.querySelector('[data-slot="sidebar-wrapper"]');
    expect(root?.classList.contains("h-svh")).toBe(true);
    const inset = document.querySelector('[data-slot="sidebar-inset"]');
    expect(inset?.classList.contains("min-h-0")).toBe(true);
    const innerMain = screen.getByRole("main");
    expect(innerMain?.classList.contains("min-h-0")).toBe(true);
    expect(innerMain?.classList.contains("flex-1")).toBe(true);
    expect(innerMain?.classList.contains("overflow-auto")).toBe(true);
  });

  test("renders exactly one main landmark holding the content, with the header outside it", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
      >
        <div data-testid="screen-content">content</div>
      </WorkspaceShell>,
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const main = screen.getByRole("main");
    expect(main.contains(screen.getByTestId("screen-content"))).toBe(true);
    const header = document.querySelector("header");
    expect(header).toBeTruthy();
    expect(main.contains(header)).toBe(false);
  });

  // fill={false} is the escape hatch back to page-scroll: must not apply
  // viewport-lock classes.
  test("fill={false} does not apply h-svh or min-h-0", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
        fill={false}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    const root = document.querySelector('[data-slot="sidebar-wrapper"]');
    expect(root?.classList.contains("h-svh")).toBe(false);
    const inset = document.querySelector('[data-slot="sidebar-inset"]');
    expect(inset?.classList.contains("min-h-0")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NavTree integration — orphaned children when their parent is filtered out
// ---------------------------------------------------------------------------

describe("WorkspaceShell — nav hierarchy after filter", () => {
  test("a nested child whose parent is filtered out surfaces as a top-level entry", () => {
    // catalog (parent) → catalog-products (child). Workspace lists the
    // CHILD only; the parent isn't a member. Expected: child renders as
    // a link instead of nesting silently disappearing.
    const schema = {
      featureName: "shop",
      entities: {},
      screens: [],
      navs: [
        { id: "catalog", label: "Catalog" },
        {
          id: "catalog-products",
          label: "Products",
          parent: "catalog",
          target: { featureId: "shop", action: "products" },
        },
      ],
      workspaces: [
        ws("ops", {
          openToAll: true,
          navMembers: ["shop:nav:catalog-products"],
        }),
      ],
    } as const;
    renderShell(
      <WorkspaceShell brand={<div>B</div>} schema={schema} user={{ id: "u", roles: [] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(screen.getByText("Products")).toBeTruthy();
    expect(screen.queryByText("Catalog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// URL sync — workspace lives in the path: /<workspace>/<screen>[/<id>]
// ---------------------------------------------------------------------------

describe("WorkspaceShell — URL sync (path-based)", () => {
  const schema = {
    featureName: "bmc",
    entities: {},
    screens: [],
    // navs must have `screen` so firstScreenIdInWorkspace can resolve the
    // screen ID. The resolver explicitly uses nav.screen, not nav.id
    // (see the comment in workspace-shell.tsx).
    navs: [
      { id: "system", label: "System", screen: "bmc:screen:system" },
      { id: "orders", label: "Orders", screen: "bmc:screen:orders" },
      { id: "tours", label: "Tours", screen: "bmc:screen:tours" },
    ],
    workspaces: [
      ws("admin", {
        roles: ["admin"],
        order: 1,
        isDefault: true,
        navMembers: ["bmc:nav:system", "bmc:nav:orders"],
      }),
      ws("dispatch", {
        roles: ["admin"],
        order: 2,
        navMembers: ["bmc:nav:orders", "bmc:nav:tours"],
      }),
    ],
  } as const;

  test("URL /<workspace>/<screen> wins over the engine-default at mount", () => {
    window.history.replaceState(null, "", "/dispatch/orders");
    renderShell(
      <WorkspaceShell brand={<div>B</div>} schema={schema} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(activeWorkspaceLabel()).toBe("dispatch");
  });

  test("clicking a tab pushes /<workspace>/<screen> to the URL", async () => {
    const user = userEvent.setup();
    renderShell(
      <WorkspaceShell brand={<div>B</div>} schema={schema} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    await user.click(screen.getByTestId("workspace-switcher-trigger"));
    await user.click(screen.getByTestId("workspace-tab-dispatch"));
    // dispatch's first nav-member is bmc:nav:orders → screenId "orders"
    expect(window.location.pathname).toBe("/dispatch/orders");
  });

  test("initial-sync uses replaceState (no extra history entry)", () => {
    // pushState during the mount-time URL fill would trap the user in a
    // back-loop: Back → / → useEffect re-pushes → Back stays inside.
    // The fix is replaceState — same URL, no history bloat. Asserts on
    // history.length so a regression to navigate() (which is pushState)
    // would fail loud.
    window.history.replaceState(null, "", "/");
    const before = window.history.length;
    renderShell(
      <WorkspaceShell brand={<div>B</div>} schema={schema} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(window.history.length).toBe(before);
    expect(window.location.pathname).toBe("/admin/system");
  });

  test("URL /<workspace> with no screen fills in the default screen", () => {
    // User types `/admin` directly (or has an old bookmark). Workspace
    // matches but screenId is empty — the effect must still fill the
    // default screen, otherwise RoutedScreen has nothing to render.
    window.history.replaceState(null, "", "/admin");
    renderShell(
      <WorkspaceShell brand={<div>B</div>} schema={schema} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(window.location.pathname).toBe("/admin/system");
  });

  test("mounting on / writes the default workspace into the URL", () => {
    // Before this fix, an empty pathname meant nav.route?.workspaceId was
    // undefined, so NavTree links rendered without /<workspace>/ prefix
    // and a click would land on a flat path that the workspace-mode parser
    // then misreads as a workspace id. WorkspaceShell now syncs on mount.
    window.history.replaceState(null, "", "/");
    renderShell(
      <WorkspaceShell brand={<div>B</div>} schema={schema} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    // admin = default. First nav-member of admin is bmc:nav:system →
    // screenId "system".
    expect(window.location.pathname).toBe("/admin/system");
  });

  test("URL /<unknown-workspace> falls through to the engine-default", () => {
    window.history.replaceState(null, "", "/ghost/whatever");
    renderShell(
      <WorkspaceShell brand={<div>B</div>} schema={schema} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    // Default workspace = admin. Ghost id ignored, no error thrown.
    expect(activeWorkspaceLabel()).toBe("admin");
  });

  test("popstate (back/forward) updates the active tab", () => {
    window.history.replaceState(null, "", "/admin/system");
    renderShell(
      <WorkspaceShell brand={<div>B</div>} schema={schema} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(activeWorkspaceLabel()).toBe("admin");
    // Simulate the user hitting "forward" to /dispatch/orders. pushState
    // alone doesn't fire popstate — we synthesize the event so the
    // hook's listener-set notifies subscribers. act() flushes the
    // ensuing React render before the next assertion.
    act(() => {
      window.history.pushState(null, "", "/dispatch/orders");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(activeWorkspaceLabel()).toBe("dispatch");
  });
});

// ---------------------------------------------------------------------------
// AppSchema (multi-feature) — workspaces with cross-feature nav members
// ---------------------------------------------------------------------------
//
// Covers the actual use case: a workspace whose navMembers reference navs
// from multiple features. Previously, this only worked through pre-qualified
// IDs in the single-feature schema; it now works correctly through
// AppSchema.features[].

describe("WorkspaceShell — AppSchema (multi-feature)", () => {
  test("admin workspace shows navs from two features in one sidebar", () => {
    const app = {
      features: [
        {
          featureName: "orders",
          entities: {},
          screens: [],
          navs: [
            { id: "list", label: "Order List", target: { featureId: "orders", action: "list" } },
          ],
        },
        {
          featureName: "fleet",
          entities: {},
          screens: [],
          navs: [
            {
              id: "vehicles",
              label: "Vehicles",
              target: { featureId: "fleet", action: "vehicles" },
            },
          ],
        },
      ],
      workspaces: [
        ws("admin", {
          label: "Admin",
          openToAll: true,
          isDefault: true,
          navMembers: ["orders:nav:list", "fleet:nav:vehicles"],
        }),
      ],
    } as const;

    renderShell(
      <WorkspaceShell brand={<div>Brand</div>} schema={app} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    // Both navs must appear in the sidebar, each qualified with its own
    // featureName. With the single-feature schema, qualifyNavId would have
    // qualified both orders and fleet under the same featureName, so the
    // allowedNavQns filter could never match fleet:nav:vehicles.
    expect(screen.getByText("Order List")).toBeTruthy();
    expect(screen.getByText("Vehicles")).toBeTruthy();
  });

  test("Workspace filter respects membership across features", () => {
    const app = {
      features: [
        {
          featureName: "orders",
          entities: {},
          screens: [],
          navs: [
            { id: "list", label: "Order List", target: { featureId: "orders", action: "list" } },
          ],
        },
        {
          featureName: "fleet",
          entities: {},
          screens: [],
          navs: [
            {
              id: "vehicles",
              label: "Vehicles",
              target: { featureId: "fleet", action: "vehicles" },
            },
          ],
        },
      ],
      workspaces: [
        ws("admin", {
          label: "Admin",
          openToAll: true,
          isDefault: true,
          navMembers: ["orders:nav:list"], // Nur Orders-Navs
        }),
        ws("dispatch", {
          label: "Dispatch",
          openToAll: true,
          navMembers: ["fleet:nav:vehicles"], // Nur Fleet-Navs
        }),
      ],
    } as const;

    renderShell(
      <WorkspaceShell brand={<div>Brand</div>} schema={app} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    // Admin is active by default → only Order List, not Vehicles.
    expect(screen.getByText("Order List")).toBeTruthy();
    expect(screen.queryByText("Vehicles")).toBeNull();
  });

  // sidebarFooter slot — symmetric with DefaultAppShell.sidebarFooter.
  // Apps use it for build information, version SHA, or a help link at the
  // bottom of the sidebar. Without the slot, apps had to mount the footer as
  // a bottom-fixed div beside the shell, outside the layout hierarchy and
  // potentially overlapping content on small viewports.
  // This regression check ensures the slot remains part of the layout.
  test("sidebarFooter slot renders at the bottom of the sidebar", () => {
    const legacy = {
      featureName: "demo",
      entities: {},
      screens: [],
      navs: [{ id: "list", label: "List" }],
      workspaces: [
        ws("admin", {
          label: "Admin",
          openToAll: true,
          isDefault: true,
          navMembers: ["demo:nav:list"],
        }),
      ],
    } as const;

    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={legacy}
        user={{ id: "u1", roles: [] }}
        sidebarFooter={<div data-testid="sidebar-footer">v1.2.3</div>}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    const footers = screen.getAllByTestId("sidebar-footer");
    expect(footers.length).toBeGreaterThan(0);
    expect(footers[0]?.textContent).toBe("v1.2.3");
    const footerContainer = footers[0]?.closest("[data-kumiko-layout='sidebar-footer']");
    expect(footerContainer?.className).toContain("border-t");
  });

  test("without sidebarFooter prop, the sidebar renders without a footer slot (default)", () => {
    const legacy = {
      featureName: "demo",
      entities: {},
      screens: [],
      navs: [{ id: "list", label: "List" }],
      workspaces: [
        ws("admin", {
          label: "Admin",
          openToAll: true,
          isDefault: true,
          navMembers: ["demo:nav:list"],
        }),
      ],
    } as const;

    renderShell(
      <WorkspaceShell brand={<div>Brand</div>} schema={legacy} user={{ id: "u1", roles: [] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(screen.queryByTestId("sidebar-footer")).toBeNull();
  });

  test("toAppSchema promotes FeatureSchema.workspaces to the app level (backwards compatibility)", () => {
    // Legacy single-feature shape with inline workspaces — the wrapper should
    // render exactly the same as an explicit AppSchema call with the same
    // contents.
    const legacy = {
      featureName: "demo",
      entities: {},
      screens: [],
      navs: [{ id: "list", label: "List", target: { featureId: "demo", action: "list" } }],
      workspaces: [
        ws("admin", {
          label: "Admin",
          openToAll: true,
          isDefault: true,
          navMembers: ["demo:nav:list"],
        }),
      ],
    } as const;

    renderShell(
      <WorkspaceShell brand={<div>Brand</div>} schema={legacy} user={{ id: "u1", roles: [] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    // The sidebar shows the nav, proving that the legacy-schema workspaces were
    // correctly promoted to the app level and that the allowedNavQns filter
    // let the entry through. WorkspaceSwitcher renders nothing for a single
    // workspace (no choice, no UI); that is not the point of this test.
    expect(screen.getByText("List")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// One nav. WorkspaceShell always renders NavTree. In the content area, an
// active target (from nav.searchParams) replaces RoutedScreen with EditorPanel.
// ---------------------------------------------------------------------------

describe("WorkspaceShell — EINE Nav", () => {
  test("workspace rendert NavTree", () => {
    const schema = {
      featureName: "demo",
      entities: {},
      screens: [],
      navs: [{ id: "list", label: "List", target: { featureId: "demo", action: "list" } }],
      workspaces: [
        ws("admin", {
          label: "Admin",
          openToAll: true,
          isDefault: true,
          navMembers: ["demo:nav:list"],
        }),
      ],
    } as const;

    renderShell(
      <WorkspaceShell brand={<div>Brand</div>} schema={schema} user={{ id: "u1", roles: [] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(screen.getByText("List")).toBeTruthy();
  });

  test("active target in the URL renders EditorPanel instead of the screen children", () => {
    // Clicking a target node persists the target in
    // searchParams (?t=feat:action&a_*=...). WorkspaceShell then renders
    // EditorPanel instead of RoutedScreen. Use a complete workspace+screen
    // path so the default-fill effect does not replace it and lose the
    // searchParams. No resolver is registered → EditorPanel fallback.
    window.history.replaceState(null, "", "/admin/x?t=demo:edit&a_id=1");
    const schema = {
      featureName: "demo",
      entities: {},
      screens: [],
      navs: [{ id: "list", label: "List" }],
      workspaces: [
        ws("admin", {
          label: "Admin",
          openToAll: true,
          isDefault: true,
          navMembers: ["demo:nav:list"],
        }),
      ],
    } as const;

    renderShell(
      <WorkspaceShell brand={<div>Brand</div>} schema={schema} user={{ id: "u1", roles: [] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    // EditorPanel fallback (no resolver for demo:edit) — proves target→Editor.
    expect(screen.getByRole("heading", { name: "Editor" })).toBeTruthy();
    // The screen children are replaced, not rendered in addition.
    expect(screen.queryByText("content")).toBeNull();
  });

  test("navBadges pass through to NavTree leaf items", () => {
    const schema = {
      featureName: "bmc",
      entities: {},
      screens: [],
      navs: [
        { id: "system", label: "System", screen: "bmc:screen:system" },
        { id: "orders", label: "Orders", screen: "bmc:screen:orders" },
      ],
      workspaces: [
        ws("admin", {
          label: "Admin",
          roles: ["admin"],
          order: 1,
          isDefault: true,
          navMembers: ["bmc:nav:system", "bmc:nav:orders"],
        }),
      ],
    } as const;

    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
        navBadges={new Map([["orders", <span>3</span>]])}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    const ordersItems = screen.getAllByText("Orders");
    const systemItems = screen.getAllByText("System");
    expect(ordersItems.some((el) => el.closest("li")?.textContent?.includes("3"))).toBe(true);
    expect(systemItems.every((el) => !el.closest("li")?.textContent?.includes("3"))).toBe(true);
  });
});

// WorkspaceShell threads `user.roles` into a UserRolesProvider around
// children. KumikoScreen reads that to gate role-restricted
// screens at render time, not just via nav/workspace-switcher filtering.
describe("WorkspaceShell wires user.roles into children for screen-level access", () => {
  const restrictedScreen: EntityListScreenDefinition = {
    id: "restricted",
    type: "entityList",
    entity: "x",
    columns: [],
    access: { roles: ["admin"] },
  };
  const schema = {
    featureName: "bmc",
    entities: {},
    screens: [restrictedScreen],
    navs: [],
    workspaces: [],
  } as const;

  test("no user prop → role-gated screen child shows access-denied", () => {
    renderShell(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <WorkspaceShell brand={<div>Brand</div>} schema={schema}>
          <KumikoScreen schema={schema} qn="bmc:screen:restricted" />
        </WorkspaceShell>
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-access-denied")).toBeTruthy();
  });

  test("user prop with matching role → role-gated screen child renders", () => {
    renderShell(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <WorkspaceShell
          brand={<div>Brand</div>}
          schema={schema}
          user={{ id: "u1", roles: ["admin"] }}
        >
          <KumikoScreen schema={schema} qn="bmc:screen:restricted" />
        </WorkspaceShell>
      </DispatcherProvider>,
    );
    expect(screen.queryByTestId("kumiko-screen-access-denied")).toBeNull();
  });
});
