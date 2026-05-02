// @vitest-environment jsdom

import type { WorkspaceSchema } from "@kumiko/renderer";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  NavProvider,
  PrimitivesProvider,
} from "@kumiko/renderer";
import { render as _render, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useBrowserNavApi } from "../app/nav";
import { filterByAccess, resolveDefaultId, WorkspaceShell } from "../layout/workspace-shell";
import { WorkspaceSwitcher } from "../layout/workspace-switcher";
import { defaultPrimitives } from "../primitives";
import { fireEvent, render, screen } from "./test-utils";

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
function renderShell(ui: ReactNode): ReturnType<typeof _render> {
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
    ? ({ openToAll: true } as const)
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
      ws("c", { openToAll: true, order: 3 }),
      ws("a", { openToAll: true, order: 1 }),
      ws("b", { openToAll: true, order: 2 }),
      ws("d", { openToAll: true }), // no order — sorts last
    ];
    expect(filterByAccess(list, []).map((w) => w.definition.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("resolveDefaultId", () => {
  const visible = [
    ws("admin", { openToAll: true }),
    ws("dispatch", { openToAll: true, isDefault: true }),
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
// WorkspaceSwitcher (presentational)
// ---------------------------------------------------------------------------

describe("WorkspaceSwitcher", () => {
  test("renders nothing for a single workspace (no choice = no UI)", () => {
    const { container } = render(
      <WorkspaceSwitcher
        workspaces={[ws("only", { openToAll: true })]}
        activeId="only"
        onSelect={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders a tab per workspace and marks the active one", () => {
    render(
      <WorkspaceSwitcher
        workspaces={[
          ws("admin", { label: "Admin", openToAll: true }),
          ws("driver", { label: "Driver", openToAll: true }),
        ]}
        activeId="admin"
        onSelect={() => {}}
      />,
    );
    const adminTab = screen.getByTestId("workspace-tab-admin");
    const driverTab = screen.getByTestId("workspace-tab-driver");
    expect(adminTab.getAttribute("aria-selected")).toBe("true");
    expect(driverTab.getAttribute("aria-selected")).toBe("false");
  });

  test("clicking a tab calls onSelect with that workspace id", () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceSwitcher
        workspaces={[
          ws("admin", { label: "Admin", openToAll: true }),
          ws("driver", { label: "Driver", openToAll: true }),
        ]}
        activeId="admin"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("workspace-tab-driver"));
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
    // navs müssen `screen` haben damit firstScreenIdInWorkspace die
    // screen-id auflösen kann. Resolver nimmt explizit nav.screen,
    // nicht nav.id (siehe workspace-shell.tsx Comment).
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

  test("an admin sees admin + dispatch in the switcher (driver hidden)", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
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
    expect(screen.getByTestId("workspace-tab-admin").getAttribute("aria-selected")).toBe("true");
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
    // admin → system + orders, NOT tours
    expect(screen.getByText("System")).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.queryByText("Tours")).toBeNull();
  });

  test("clicking the dispatch tab swaps the visible nav set", () => {
    renderShell(
      <WorkspaceShell
        brand={<div>Brand</div>}
        schema={schema}
        user={{ id: "u1", roles: ["admin"] }}
      >
        <div>content</div>
      </WorkspaceShell>,
    );
    fireEvent.click(screen.getByTestId("workspace-tab-dispatch"));
    // dispatch → orders + tours, NOT system
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("Tours")).toBeTruthy();
    expect(screen.queryByText("System")).toBeNull();
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
    expect(screen.getByText("Tours")).toBeTruthy();
    expect(screen.queryByText("System")).toBeNull();
    expect(screen.queryByText("Orders")).toBeNull();
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
    expect(screen.getByTestId("workspace-tab-dispatch").getAttribute("aria-selected")).toBe("true");
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
        { id: "catalog-products", label: "Products", parent: "catalog" },
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
    // navs müssen `screen` haben damit firstScreenIdInWorkspace die
    // screen-id auflösen kann. Resolver nimmt explizit nav.screen,
    // nicht nav.id (siehe workspace-shell.tsx Comment).
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
    expect(screen.getByTestId("workspace-tab-dispatch").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("workspace-tab-admin").getAttribute("aria-selected")).toBe("false");
  });

  test("clicking a tab pushes /<workspace>/<screen> to the URL", () => {
    renderShell(
      <WorkspaceShell brand={<div>B</div>} schema={schema} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    fireEvent.click(screen.getByTestId("workspace-tab-dispatch"));
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
    expect(screen.getByTestId("workspace-tab-admin").getAttribute("aria-selected")).toBe("true");
  });

  test("popstate (back/forward) updates the active tab", () => {
    window.history.replaceState(null, "", "/admin/system");
    renderShell(
      <WorkspaceShell brand={<div>B</div>} schema={schema} user={{ id: "u1", roles: ["admin"] }}>
        <div>content</div>
      </WorkspaceShell>,
    );
    expect(screen.getByTestId("workspace-tab-admin").getAttribute("aria-selected")).toBe("true");
    // Simulate the user hitting "forward" to /dispatch/orders. pushState
    // alone doesn't fire popstate — we synthesize the event so the
    // hook's listener-set notifies subscribers. act() flushes the
    // ensuing React render before the next assertion.
    act(() => {
      window.history.pushState(null, "", "/dispatch/orders");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("workspace-tab-dispatch").getAttribute("aria-selected")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// AppSchema (multi-feature) — workspaces with cross-feature nav members
// ---------------------------------------------------------------------------
//
// Hier deckt die Test-Klammer den eigentlichen Use-Case ab: ein Workspace
// dessen navMembers Navs aus mehreren Features referenzieren. Vorher
// ging das nur über pre-qualifizierte ids im single-feature schema, jetzt
// sauber über AppSchema.features[].

describe("WorkspaceShell — AppSchema (multi-feature)", () => {
  test("admin Workspace zeigt Navs aus zwei Features in einer Sidebar", () => {
    const app = {
      features: [
        {
          featureName: "orders",
          entities: {},
          screens: [],
          navs: [{ id: "list", label: "Order List" }],
        },
        {
          featureName: "fleet",
          entities: {},
          screens: [],
          navs: [{ id: "vehicles", label: "Vehicles" }],
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
    // Beide Navs müssen in der Sidebar landen, jede mit ihrem eigenen
    // featureName qualifiziert. Vorher (single-feature schema) hätte
    // qualifyNavId orders+fleet beide unter dem einen featureName
    // qualifiziert und der allowedNavQns-Filter hätte fleet:nav:vehicles
    // nie matchen können.
    expect(screen.getByText("Order List")).toBeTruthy();
    expect(screen.getByText("Vehicles")).toBeTruthy();
  });

  test("Workspace-Filter respektiert features-übergreifende Membership", () => {
    const app = {
      features: [
        {
          featureName: "orders",
          entities: {},
          screens: [],
          navs: [{ id: "list", label: "Order List" }],
        },
        {
          featureName: "fleet",
          entities: {},
          screens: [],
          navs: [{ id: "vehicles", label: "Vehicles" }],
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
    // Admin = aktiv (default) → nur Order List, KEIN Vehicles.
    expect(screen.getByText("Order List")).toBeTruthy();
    expect(screen.queryByText("Vehicles")).toBeNull();
  });

  // sidebarFooter-Slot — symmetrisch zu DefaultAppShell.sidebarFooter.
  // Apps nutzen das für Build-Info / Version-SHA / Help-Link am unteren
  // Sidebar-Rand. Ohne den Slot mussten Apps den Footer als bottom-fixed
  // div neben der Shell mounten — sieht aus, ist aber außerhalb der
  // Layout-Hierarchie und überlappt bei kleinen Viewports den Content.
  // Regression-Anker: Wenn jemand den Slot wegrefactoriert, fällt das
  // hier auf, nicht erst beim nächsten Workspace-Sample.
  test("sidebarFooter-Slot rendert unten in der Sidebar", () => {
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
    expect(screen.getByTestId("sidebar-footer")).toBeTruthy();
    expect(screen.getByTestId("sidebar-footer").textContent).toBe("v1.2.3");
  });

  test("ohne sidebarFooter-Prop rendert die Sidebar ohne Footer-Slot (default)", () => {
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

  test("toAppSchema hebt FeatureSchema.workspaces auf App-Ebene (Backwards-Compat)", () => {
    // Legacy single-feature shape mit inline workspaces — der Wrapper
    // soll exakt das gleiche Rendering liefern wie ein expliziter
    // AppSchema-Aufruf mit demselben Inhalt.
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
    // Sidebar zeigt den nav — beweist dass die Legacy-Schema-Workspaces
    // korrekt zur App-Ebene hochgehoben wurden und der allowedNavQns-
    // Filter den Eintrag durchließ. WorkspaceSwitcher rendert bei einem
    // einzelnen Workspace nichts (no-choice-no-UI), das ist nicht der
    // Test-Punkt hier.
    expect(screen.getByText("List")).toBeTruthy();
  });
});
