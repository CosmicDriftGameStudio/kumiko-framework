//
// NavTree: sidebar navigation from the schema. It enforces two contracts:
//   1. A section header (parent without a screen) plus child collapse via
//      chevron click, with state local to NavTree.
//   2. The active state applies to a node with a screen when nav.route's
//      screenId matches (standard sidebar behavior).

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import type {
  NavIconKey,
  TargetRef,
  TreeAction,
  TreeChildrenSubscribe,
  TreeNode,
} from "@cosmicdrift/kumiko-framework/engine";
import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import { LIVE_REFETCH_COALESCE_MS } from "../../hooks/live-refetch-scheduler.ts";
import type { FeatureSchema, LiveEventSubscriber, NavApi } from "../../index.ts";
import { LiveEventsProvider, NavProvider } from "../../index.ts";
import { NavProvidersProvider } from "../app/nav-providers-context.tsx";
import { NavTree } from "../layout/nav-tree.tsx";
import { setDispatchListener } from "../layout/target-resolver-stub.tsx";
import { fireEvent, renderWithSidebar as render, screen } from "./test-utils.tsx";

function makeSchema(): FeatureSchema {
  return {
    featureName: "showcase",
    entities: {},
    screens: [
      { id: "items", type: "entityList", entity: "item", columns: [] },
      { id: "active", type: "entityList", entity: "item", columns: [] },
      { id: "backlog", type: "entityList", entity: "item", columns: [] },
    ],
    navs: [
      // Section without a screen but with children — collapsible (variant 2)
      { id: "data", label: "Data", order: 10 },
      // Parent with a screen and children — link plus separate chevron (variant 1)
      {
        id: "items",
        label: "Items",
        parent: "data",
        screen: "items",
        order: 10,
      },
      {
        id: "active",
        label: "Active",
        parent: "items",
        screen: "active",
        order: 10,
      },
      {
        id: "backlog",
        label: "Backlog",
        parent: "items",
        screen: "backlog",
        order: 20,
      },
    ],
  } satisfies FeatureSchema;
}

function makeRoleGatedSchema(): FeatureSchema {
  return {
    featureName: "showcase",
    entities: {},
    screens: [
      { id: "public-screen", type: "entityList", entity: "x", columns: [] },
      { id: "admin-screen", type: "entityList", entity: "x", columns: [] },
      { id: "sysadmin-screen", type: "entityList", entity: "x", columns: [] },
    ],
    navs: [
      // Public — no access rule, visible to everyone (including anonymous users)
      { id: "public", label: "Public", screen: "public-screen", order: 10 },
      // Admin — only users with the "Admin" role
      {
        id: "admin",
        label: "Admin",
        screen: "admin-screen",
        order: 20,
        access: { roles: ["Admin"] },
      },
      // Sysadmin — only users with the "SystemAdmin" role
      {
        id: "sysadmin",
        label: "Sysadmin",
        screen: "sysadmin-screen",
        order: 30,
        access: { roles: ["SystemAdmin"] },
      },
    ],
  } satisfies FeatureSchema;
}

describe("NavTree role-gating", () => {
  // Regression coverage: DefaultAppShell previously failed to pass through the
  // user prop, so resolveNavigation saw user=undefined and hid ALL role-gated
  // navigation entries, even when the user actually had the required role.

  test("user with ['SystemAdmin','User'] sees public + sysadmin, NOT admin", () => {
    render(
      <NavTree
        schema={makeRoleGatedSchema()}
        user={{ id: "u1", roles: ["SystemAdmin", "User"] }}
      />,
    );
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Sysadmin")).toBeTruthy();
    expect(screen.queryByText("Admin")).toBeNull();
  });

  test("user with ['Admin'] sees public + admin, NOT sysadmin", () => {
    render(<NavTree schema={makeRoleGatedSchema()} user={{ id: "u1", roles: ["Admin"] }} />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.queryByText("Sysadmin")).toBeNull();
  });

  test("Without user-prop (anonymous) → role-gated navs hidden, only public visible", () => {
    // This is the behavior caused by the production bug: when DefaultAppShell
    // fails to pass through user, resolveNavigation treats the request as
    // anonymous and hides all role-gated navigation entries.
    render(<NavTree schema={makeRoleGatedSchema()} />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("Sysadmin")).toBeNull();
  });

  test("multi-role merge: user with overlapping roles sees both", () => {
    render(
      <NavTree
        schema={makeRoleGatedSchema()}
        user={{ id: "u1", roles: ["Admin", "SystemAdmin", "User"] }}
      />,
    );
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByText("Sysadmin")).toBeTruthy();
  });
});

// Lucide tags every icon's <svg> with a `lucide-<slug>` class (see
// createLucideIcon) — asserting on it distinguishes "icon X rendered" from
// "some svg rendered", so a NAV_ICONS entry pointing at the wrong component
// (or a duplicate) fails even when the total svg count still matches.
const NAV_ICON_LUCIDE_CLASS: Readonly<Record<string, string>> = {
  dashboard: "lucide-layout-dashboard",
  layers: "lucide-layers",
  building: "lucide-building",
  tag: "lucide-tag",
  key: "lucide-key-round",
  server: "lucide-server",
  mail: "lucide-mail",
  download: "lucide-download",
  upload: "lucide-upload",
  rocket: "lucide-rocket",
  palette: "lucide-palette",
  link: "lucide-link",
  share: "lucide-share-2",
  send: "lucide-send",
  "shield-check": "lucide-shield-check",
  gauge: "lucide-gauge",
};

function navIconSvgs(container: HTMLElement): SVGElement[] {
  return Array.from(container.querySelectorAll("svg")).filter(
    (svg) => !(svg.getAttribute("class") ?? "").includes("lucide-search"),
  );
}

function expectNavIcons(container: HTMLElement, iconKeys: readonly string[]): void {
  const classes = navIconSvgs(container).map((svg) => svg.getAttribute("class") ?? "");
  expect(classes).toHaveLength(iconKeys.length);
  iconKeys.forEach((key, i) => {
    expect(classes[i]).toContain(NAV_ICON_LUCIDE_CLASS[key]);
  });
}

describe("NavTree", () => {
  let warnSpy: Mock<typeof console.warn>;
  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    // spyOn reuses the same underlying mock across calls on the same target
    // within a process — without an explicit clear, call history from a
    // PRIOR test in this describe block leaks into the next test's spy.
    warnSpy.mockClear();
  });
  afterAll(() => {
    warnSpy.mockRestore();
  });

  test("Section-Header (parent without screen) is a static label, children visible", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    // Section "Data" is a STATIC heading (sidebar-07 pattern), not a toggle
    // button — collapse belongs on items with children, not on the section.
    expect(screen.getByText("Data")).toBeTruthy();
    expect(screen.getByText("Data").closest("button")).toBeNull();

    expect(screen.getByText("Items")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Backlog")).toBeTruthy();
  });

  test("Section-Header collapst NICHT — children bleiben sichtbar", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    // There is no section toggle: "Data" is not inside a button, so there is
    // nothing to click. The items must remain permanently visible.
    expect(screen.getByText("Data").closest("button")).toBeNull();
    expect(screen.getByText("Items")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  test("Each Nav-label span carries title === Label, so truncated entries are readable on hover", () => {
    const labels = [
      "Quarterly consolidated financial reporting overview",
      "Extraordinarily long linked parent entry label",
      "Deeply nested child screen with a very long label",
      "Nested grouping entry without a screen but long label",
      "Grandchild below the nested grouping entry label",
    ] as const;
    const schema = {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "top", type: "entityList", entity: "x", columns: [] },
        { id: "child", type: "entityList", entity: "x", columns: [] },
        { id: "grandchild", type: "entityList", entity: "x", columns: [] },
      ],
      navs: [
        { id: "section", label: labels[0], order: 10 },
        { id: "top", label: labels[1], parent: "section", screen: "top", order: 10 },
        { id: "child", label: labels[2], parent: "top", screen: "child", order: 10 },
        { id: "group", label: labels[3], parent: "top", order: 20 },
        { id: "grandchild", label: labels[4], parent: "group", screen: "grandchild", order: 10 },
      ],
    } satisfies FeatureSchema;
    render(<NavTree schema={schema} testId="tree" />);

    // labels[0] is a static section heading (SidebarGroupLabel), not a nav entry span.
    for (const label of labels.slice(1)) {
      const span = screen.getByText(label);
      expect(span.getAttribute("title")).toBe(label);
    }
  });

  test("Parent with Screen + children — Chevron click toggles, without navigation", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    // "Items" hat children Active+Backlog; default expanded
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Backlog")).toBeTruthy();

    // The section header "Data" is a single toggle button (with no nested
    // chevron button). In contrast, the parent-with-screen "Items" renders
    // a KumikoLink and a separate sibling chevron button — the only button
    // with an aria-label of "Expand" or "Collapse".
    // The aria label comes from the framework's default bundle. The test
    // setup runs in "en"; apps can override it in their own bundles via
    // `kumiko.nav.*`.
    const chevronButtons = screen.getAllByRole("button", { name: /Expand|Collapse/ });
    expect(chevronButtons.length).toBe(1);
    fireEvent.click(chevronButtons[0] as HTMLButtonElement);

    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Backlog")).toBeNull();
    // Items itself stays visible
    expect(screen.getByText("Items")).toBeTruthy();
  });

  test("Nav entry with a known icon renders a Lucide icon; without an icon, only the label", () => {
    const schema = {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "dash", type: "entityList", entity: "x", columns: [] },
        { id: "plain", type: "entityList", entity: "x", columns: [] },
      ],
      navs: [
        { id: "dash", label: "Dash", screen: "dash", order: 10, icon: "dashboard" },
        { id: "plain", label: "Plain", screen: "plain", order: 20 },
      ],
    } satisfies FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    // Flat nav without sections means no chevrons; exactly one nav svg (the
    // dashboard icon) because the icon-less item renders no leading element.
    expect(container.querySelector(".rounded-full")).toBeNull();
    expectNavIcons(container, ["dashboard"]);
  });

  test("layers + building (money-horse credit groups/tenants) resolve to an icon", () => {
    const schema = {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "groups", type: "entityList", entity: "x", columns: [] },
        { id: "tenants", type: "entityList", entity: "x", columns: [] },
      ],
      navs: [
        { id: "groups", label: "Gruppen", screen: "groups", order: 10, icon: "layers" },
        { id: "tenants", label: "Mandanten", screen: "tenants", order: 20, icon: "building" },
      ],
    } satisfies FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    expectNavIcons(container, ["layers", "building"]);
  });

  test("tag + key (custom-fields / api-tokens) resolve to an icon", () => {
    const schema = {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "fields", type: "entityList", entity: "x", columns: [] },
        { id: "tokens", type: "entityList", entity: "x", columns: [] },
      ],
      navs: [
        { id: "fields", label: "Felder", screen: "fields", order: 10, icon: "tag" },
        { id: "tokens", label: "Tokens", screen: "tokens", order: 20, icon: "key" },
      ],
    } satisfies FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    expectNavIcons(container, ["tag", "key"]);
  });

  test("server, mail, download, upload, rocket resolve to an icon (config/SMTP nav)", () => {
    // The config settings hub derives child nav icons from a ConfigKey's
    // mask.icon (smtp-host="server", from="mail", subscription="rocket");
    // a missing NAV_ICONS entry renders the nav blank instead of an icon.
    // download/upload guard the same map against feature-authored icons
    // (e.g. GDPR export-job nav).
    const schema = {
      featureName: "app",
      entities: {},
      screens: [
        { id: "a", type: "entityList", entity: "x", columns: [] },
        { id: "b", type: "entityList", entity: "x", columns: [] },
        { id: "c", type: "entityList", entity: "x", columns: [] },
        { id: "d", type: "entityList", entity: "x", columns: [] },
        { id: "e", type: "entityList", entity: "x", columns: [] },
      ],
      navs: [
        { id: "a", label: "SMTP", screen: "a", order: 10, icon: "server" },
        { id: "b", label: "From", screen: "b", order: 20, icon: "mail" },
        { id: "c", label: "Export", screen: "c", order: 30, icon: "download" },
        { id: "d", label: "Import", screen: "d", order: 40, icon: "upload" },
        { id: "e", label: "Billing", screen: "e", order: 50, icon: "rocket" },
      ],
    } satisfies FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    expectNavIcons(container, ["server", "mail", "download", "upload", "rocket"]);
  });

  test("palette, link, and share render Lucide icons (Share-/Branding-Nav)", () => {
    const schema = {
      featureName: "app",
      entities: {},
      screens: [
        { id: "branding", type: "entityList", entity: "x", columns: [] },
        { id: "links", type: "entityList", entity: "x", columns: [] },
        { id: "defaults", type: "entityList", entity: "x", columns: [] },
      ],
      navs: [
        { id: "branding", label: "Branding", screen: "branding", order: 10, icon: "palette" },
        { id: "links", label: "Links", screen: "links", order: 20, icon: "link" },
        { id: "defaults", label: "Defaults", screen: "defaults", order: 30, icon: "share" },
      ],
    } satisfies FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    expectNavIcons(container, ["palette", "link", "share"]);
  });

  test("send and shield-check render Lucide icons", () => {
    const schema = {
      featureName: "app",
      entities: {},
      screens: [
        { id: "delivery-log", type: "entityList", entity: "x", columns: [] },
        { id: "profile-picker", type: "entityList", entity: "x", columns: [] },
        { id: "cap-list", type: "entityList", entity: "x", columns: [] },
      ],
      navs: [
        { id: "delivery-log", label: "Log", screen: "delivery-log", order: 10, icon: "send" },
        {
          id: "profile-picker",
          label: "Profile",
          screen: "profile-picker",
          order: 20,
          icon: "shield-check",
        },
        { id: "cap-list", label: "Caps", screen: "cap-list", order: 60, icon: "gauge" },
      ],
    } satisfies FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    expectNavIcons(container, ["send", "shield-check", "gauge"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("Unknown icon key falls back cleanly to plain text (no svg), but displays a warning", () => {
    const schema = {
      featureName: "showcase",
      entities: {},
      screens: [{ id: "x", type: "entityList", entity: "x", columns: [] }],
      navs: [
        {
          id: "x",
          label: "X",
          screen: "x",
          order: 10,
          // Deliberately unregistered — asserts the runtime fallback, not the
          // (now compile-time) NavIconKey vocabulary.
          icon: "does-not-exist" as NavIconKey,
        },
      ],
    } satisfies FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    expect(navIconSvgs(container)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Nav entry "showcase:nav:x" references icon "does-not-exist"'),
    );
  });

  test("bekannter icon-Key warnt NICHT", () => {
    const schema = {
      featureName: "showcase",
      entities: {},
      screens: [{ id: "dash", type: "entityList", entity: "x", columns: [] }],
      navs: [{ id: "dash", label: "Dash", screen: "dash", order: 10, icon: "dashboard" }],
    } satisfies FeatureSchema;
    render(<NavTree schema={schema} />);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("No icon set does NOT warn (Bundled Features without an icon are not an error)", () => {
    const schema = {
      featureName: "showcase",
      entities: {},
      screens: [{ id: "plain", type: "entityList", entity: "x", columns: [] }],
      navs: [{ id: "plain", label: "Plain", screen: "plain", order: 10 }],
    } satisfies FeatureSchema;
    render(<NavTree schema={schema} />);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("NavTree navBadges (Runtime-Badge-Slot)", () => {
  // The app supplies a ReactNode per bare nav ID (including its value and
  // color). Keys use lastSegment(qualifiedName), so the app writes
  // "tarif", not "showcase:nav:tarif".
  function flatSchema(): FeatureSchema {
    return {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "tarif", type: "entityList", entity: "x", columns: [] },
        { id: "plain", type: "entityList", entity: "x", columns: [] },
      ],
      navs: [
        { id: "tarif", label: "Tarif & Limits", screen: "tarif", order: 10 },
        { id: "plain", label: "Plain", screen: "plain", order: 20 },
      ],
    } satisfies FeatureSchema;
  }

  test("Badge keyed to bare nav-id appears in the matching item, not in others", () => {
    render(<NavTree schema={flatSchema()} navBadges={new Map([["tarif", <span>Pro</span>]])} />);
    const badge = screen.getByText("Pro");
    expect(screen.getByText("Tarif & Limits").closest("li")?.textContent).toContain("Pro");
    expect(screen.getByText("Plain").closest("li")?.textContent).not.toContain("Pro");
    // The slot wrapper pushes the badge to the right (ml-auto), while the
    // badge itself must not shrink away.
    expect(badge.parentElement?.className).toContain("ml-auto");
  });

  test("Without navBadges → no badge slot", () => {
    render(<NavTree schema={flatSchema()} />);
    expect(screen.queryByText("Pro")).toBeNull();
  });

  test("Key without a matching item → nothing (silent), remaining items render normally", () => {
    render(
      <NavTree
        schema={flatSchema()}
        navBadges={new Map([["does-not-exist", <span>Ghost</span>]])}
      />,
    );
    expect(screen.queryByText("Ghost")).toBeNull();
    expect(screen.getByText("Tarif & Limits")).toBeTruthy();
  });
});

// Leaving a list for a sub-screen (entityEdit/actionForm/...) used
// to lose BOTH orientation cues at once — nav marks nothing, breadcrumb
// shrinks to one crumb. NavTree now falls back to resolveParentScreenId
// (same resolution shell-breadcrumb.ts uses) when the routed screen has no
// node of its own in the tree.
function navWithRoute(screenId: string): NavApi {
  return {
    route: { screenId },
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => {},
  };
}

describe("NavTree active-marker parent fallback", () => {
  test("screen without its own nav entry highlights the resolved parent, without aria-current", () => {
    const schema: FeatureSchema = {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "user-list", type: "entityList", entity: "profile", columns: [] },
        {
          id: "user-edit",
          type: "entityEdit",
          // Deliberately a DIFFERENT entity than "user-list" — the old
          // same-entity heuristic must NOT be what resolves this; only the
          // explicit listScreenId does.
          entity: "user-detail",
          listScreenId: "user-list",
          layout: { sections: [{ fields: [] }] },
        },
      ],
      navs: [{ id: "user-list", label: "Users", screen: "user-list", order: 10 }],
    } satisfies FeatureSchema;

    render(
      <NavProvider value={navWithRoute("user-edit")}>
        <NavTree schema={schema} />
      </NavProvider>,
    );

    const link = screen.getByText("Users").closest("a");
    expect(link?.getAttribute("data-active")).toBe("true");
    expect(link?.hasAttribute("aria-current")).toBe(false);
  });

  test("screen with its own nav entry still marks itself and keeps aria-current=page", () => {
    const schema: FeatureSchema = {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "user-list", type: "entityList", entity: "profile", columns: [] },
        {
          id: "user-edit",
          type: "entityEdit",
          entity: "profile",
          layout: { sections: [{ fields: [] }] },
        },
      ],
      navs: [
        { id: "user-list", label: "Users", screen: "user-list", order: 10 },
        { id: "user-edit", label: "Edit User", screen: "user-edit", order: 20 },
      ],
    } satisfies FeatureSchema;

    render(
      <NavProvider value={navWithRoute("user-edit")}>
        <NavTree schema={schema} />
      </NavProvider>,
    );

    const editLink = screen.getByText("Edit User").closest("a");
    expect(editLink?.getAttribute("data-active")).toBe("true");
    expect(editLink?.getAttribute("aria-current")).toBe("page");

    // The list is not silently highlighted too — only the exact match is.
    const listLink = screen.getByText("Users").closest("a");
    expect(listLink?.getAttribute("data-active")).toBe("false");
    expect(listLink?.hasAttribute("aria-current")).toBe(false);
  });

  test("editing an existing record marks the list instead of the edit screen's own nav entry", () => {
    const schema: FeatureSchema = {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "user-list", type: "entityList", entity: "profile", columns: [] },
        {
          id: "user-edit",
          type: "entityEdit",
          entity: "profile",
          listScreenId: "user-list",
          layout: { sections: [{ fields: [] }] },
        },
      ],
      navs: [
        { id: "user-list", label: "Users", screen: "user-list", order: 10 },
        { id: "user-edit", label: "Add User", screen: "user-edit", order: 20 },
      ],
    } satisfies FeatureSchema;

    render(
      <NavProvider
        value={{ ...navWithRoute("user-edit"), route: { screenId: "user-edit", entityId: "u1" } }}
      >
        <NavTree schema={schema} />
      </NavProvider>,
    );

    expect(screen.getByText("Users").closest("a")?.getAttribute("data-active")).toBe("true");
    expect(screen.getByText("Add User").closest("a")?.getAttribute("data-active")).toBe("false");
  });

  test("explicit listScreenId on an actionForm beats the rowAction heuristic for the nav highlight", () => {
    const schema: FeatureSchema = {
      featureName: "billing",
      entities: {},
      screens: [
        {
          id: "invoice-list",
          type: "entityList",
          entity: "invoice",
          columns: [],
          rowActions: [
            {
              kind: "navigate",
              id: "approve",
              label: "kumiko.actions.view",
              screen: "invoice-approve",
              entityId: "id",
            },
          ],
        },
        { id: "invoice-archive", type: "entityList", entity: "invoice", columns: [] },
        {
          id: "invoice-approve",
          type: "actionForm",
          handler: "billing:write:invoice:approve",
          listScreenId: "invoice-archive",
          fields: { notes: { type: "text" } },
          layout: { sections: [{ fields: ["notes"] }] },
        },
      ],
      navs: [
        { id: "invoice-list", label: "Invoices", screen: "invoice-list", order: 10 },
        { id: "invoice-archive", label: "Archive", screen: "invoice-archive", order: 20 },
      ],
    } satisfies FeatureSchema;

    render(
      <NavProvider value={navWithRoute("invoice-approve")}>
        <NavTree schema={schema} />
      </NavProvider>,
    );

    const archiveLink = screen.getByText("Archive").closest("a");
    expect(archiveLink?.getAttribute("data-active")).toBe("true");
    expect(archiveLink?.hasAttribute("aria-current")).toBe(false);
    expect(screen.getByText("Invoices").closest("a")?.getAttribute("data-active")).toBe("false");
  });
});

// ── Visual-tree merge: dynamic nodes in the single navigation tree ─────
//
// Covers the four capabilities inherited from the old VisualTree:
// target dispatch, lazy provider children, createAction (+), and the
// critical SSE-treeEntities refresh that adds new nodes LIVE to the
// navigation (otherwise the tree loads once and "+pricing" never appears).

type LiveCb = Parameters<LiveEventSubscriber>[1];

function controllableLiveEvents(): {
  readonly subscribe: LiveEventSubscriber;
  fire(entity: string): void;
} {
  const listeners = new Map<string, Set<LiveCb>>();
  const subscribe: LiveEventSubscriber = (entity, cb) => {
    const set = listeners.get(entity) ?? new Set<LiveCb>();
    set.add(cb);
    listeners.set(entity, set);
    return () => {
      set.delete(cb);
    };
  };
  return {
    subscribe,
    fire(entity) {
      // The consumer callbacks (NavTree, production code) ignore the event
      // argument, so a zero-argument call is sufficient; the cast only bridges
      // the parameter signatures.
      for (const cb of listeners.get(entity) ?? []) (cb as () => void)();
    },
  };
}

async function fireAndFlushCoalesced(
  live: ReturnType<typeof controllableLiveEvents>,
  entity: string,
  times = 1,
): Promise<void> {
  jest.useFakeTimers();
  try {
    await act(async () => {
      for (let i = 0; i < times; i++) live.fire(entity);
      jest.advanceTimersByTime(LIVE_REFETCH_COALESCE_MS);
    });
  } finally {
    jest.useRealTimers();
  }
}

function pageLeaf(slug: string): TreeNode {
  return { label: slug, target: { featureId: "cms", action: "edit", args: { slug } } };
}

// A `provider: true` node named "Content" with a "+" createAction. QN =
// "cms:nav:content" (featureName:nav:id). The provider supplies the children.
function dynamicSchema(): FeatureSchema {
  return {
    featureName: "cms",
    entities: {},
    screens: [],
    navs: [
      {
        id: "content",
        label: "Content",
        order: 10,
        provider: true,
        createAction: {
          icon: "plus",
          label: "New page",
          target: { featureId: "cms", action: "create", args: { folder: "" } },
        },
      },
    ],
  } satisfies FeatureSchema;
}

function renderDynamic(args: {
  readonly schema: FeatureSchema;
  readonly providers: ReadonlyMap<string, TreeChildrenSubscribe>;
  readonly entities?: ReadonlyMap<string, readonly string[]>;
  readonly live?: LiveEventSubscriber;
}): ReturnType<typeof render> {
  const inner: ReactNode = (
    <NavProvidersProvider
      value={args.providers}
      {...(args.entities && { entities: args.entities })}
    >
      <NavTree schema={args.schema} />
    </NavProvidersProvider>
  );
  // A dedicated, controllable LiveEventsProvider overrides the no-op provider
  // from DefaultProviders (the nearest provider wins).
  return render(
    args.live !== undefined ? (
      <LiveEventsProvider value={args.live}>{inner}</LiveEventsProvider>
    ) : (
      inner
    ),
  );
}

describe("NavTree dynamic provider nodes", () => {
  let restoreDispatch: (() => void) | undefined;
  afterEach(() => {
    restoreDispatch?.();
    restoreDispatch = undefined;
  });

  test("provider:true node lazily loads and renders its children (default-expanded)", async () => {
    const provider: TreeChildrenSubscribe = () => (emit) => {
      emit([pageLeaf("apex"), pageLeaf("hero")]);
      return () => {};
    };
    const providers = new Map([["cms:nav:content", provider]]);
    await act(async () => {
      renderDynamic({ schema: dynamicSchema(), providers });
    });

    expect(screen.getByText("Content")).toBeTruthy();
    expect(screen.getByText("apex")).toBeTruthy();
    expect(screen.getByText("hero")).toBeTruthy();
  });

  test("createAction renders a plus button that dispatches its target", async () => {
    let dispatched: TargetRef | undefined;
    restoreDispatch = setDispatchListener((t) => {
      dispatched = t;
    });
    const provider: TreeChildrenSubscribe = () => (emit) => {
      emit([pageLeaf("apex")]);
      return () => {};
    };
    await act(async () => {
      renderDynamic({
        schema: dynamicSchema(),
        providers: new Map([["cms:nav:content", provider]]),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "New page" }));
    expect(dispatched).toEqual({ featureId: "cms", action: "create", args: { folder: "" } });
  });

  test("createAction with screen renders a link to the correct route instead of dispatching", async () => {
    let dispatched: TargetRef | undefined;
    restoreDispatch = setDispatchListener((t) => {
      dispatched = t;
    });
    const schema: FeatureSchema = {
      featureName: "cms",
      entities: {},
      screens: [{ id: "new-page", type: "entityList", entity: "item", columns: [] }],
      navs: [
        {
          id: "content",
          label: "Content",
          order: 10,
          provider: true,
          createAction: { icon: "plus", label: "New page", screen: "cms:screen:new-page" },
        },
      ],
    } satisfies FeatureSchema;
    const provider: TreeChildrenSubscribe = () => (emit) => {
      emit([pageLeaf("apex")]);
      return () => {};
    };
    await act(async () => {
      renderDynamic({ schema, providers: new Map([["cms:nav:content", provider]]) });
    });

    const link = screen.getByRole("link", { name: "New page" });
    expect(link.getAttribute("href")).toBe("/new-page");
    fireEvent.click(link);
    expect(dispatched).toBeUndefined();
  });

  test("actions[] entry with screen renders a link to the correct route instead of dispatching", async () => {
    let dispatched: TargetRef | undefined;
    restoreDispatch = setDispatchListener((t) => {
      dispatched = t;
    });
    const schema: FeatureSchema = {
      featureName: "cms",
      entities: {},
      screens: [{ id: "hero", type: "entityList", entity: "item", columns: [] }],
      navs: [
        {
          id: "hero",
          label: "Hero",
          order: 10,
          actions: [{ icon: "edit", label: "Edit hero", screen: "cms:screen:hero" }],
        },
      ],
    } satisfies FeatureSchema;
    await act(async () => {
      renderDynamic({ schema, providers: new Map() });
    });

    const link = screen.getByRole("link", { name: "Edit hero" });
    expect(link.getAttribute("href")).toBe("/hero");
    fireEvent.click(link);
    expect(dispatched).toBeUndefined();
  });

  // Boot validates screen XOR target for NavDefinition actions, but
  // a schema handed straight to NavTree (as here, and as a provider-emitted
  // TreeNode at runtime) bypasses that — neither must not render a dead
  // button, it must warn once and drop the action.
  test("actions[] entry without screen and without target renders nothing and warns once", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const schema: FeatureSchema = {
        featureName: "cms",
        entities: {},
        screens: [],
        navs: [
          {
            id: "hero",
            label: "Hero",
            order: 10,
            actions: [{ icon: "edit", label: "Broken action" } as TreeAction],
          },
        ],
      } satisfies FeatureSchema;
      await act(async () => {
        renderDynamic({ schema, providers: new Map() });
      });

      expect(screen.queryByRole("button", { name: "Broken action" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Broken action" })).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain("Broken action");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("actions[] entry with screen and target renders the link and warns that target is ignored", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const schema: FeatureSchema = {
        featureName: "cms",
        entities: {},
        screens: [],
        navs: [
          {
            id: "hero",
            label: "Hero",
            order: 10,
            actions: [
              {
                icon: "edit",
                label: "Ambiguous action",
                screen: "cms:screen:hero-edit",
                target: { featureId: "cms", action: "edit" },
              } as unknown as TreeAction,
            ],
          },
        ],
      } satisfies FeatureSchema;
      await act(async () => {
        renderDynamic({ schema, providers: new Map() });
      });

      expect(screen.getByRole("link", { name: "Ambiguous action" })).toBeTruthy();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain("Ambiguous action");
      expect(warnSpy.mock.calls[0]?.[0]).toContain('both "screen" and "target"');
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("target node dispatches on click (instead of a route link)", async () => {
    let dispatched: TargetRef | undefined;
    restoreDispatch = setDispatchListener((t) => {
      dispatched = t;
    });
    const schema = {
      featureName: "cms",
      entities: {},
      screens: [],
      navs: [
        {
          id: "hero",
          label: "Hero",
          order: 10,
          target: { featureId: "cms", action: "edit", args: { slug: "hero" } },
        },
      ],
    } satisfies FeatureSchema;
    await act(async () => {
      renderDynamic({ schema, providers: new Map() });
    });

    fireEvent.click(screen.getByText("Hero"));
    expect(dispatched).toEqual({ featureId: "cms", action: "edit", args: { slug: "hero" } });
  });

  test("SSE-treeEntities-Refresh bringt neu erstellte Knoten LIVE in die Nav", async () => {
    // The key behavior: a text-block event re-fires the provider, so the newly
    // created page ("pricing") appears without a remount.
    let pages = ["apex", "hero"];
    const provider: TreeChildrenSubscribe = () => (emit) => {
      emit(pages.map(pageLeaf));
      return () => {};
    };
    const live = controllableLiveEvents();
    await act(async () => {
      renderDynamic({
        schema: dynamicSchema(),
        providers: new Map([["cms:nav:content", provider]]),
        entities: new Map([["cms:nav:content", ["text-block"]]]),
        live: live.subscribe,
      });
    });

    expect(screen.getByText("apex")).toBeTruthy();
    expect(screen.queryByText("pricing")).toBeNull();

    // A new page is created → the text-block event fires → the provider re-fires.
    pages = ["apex", "hero", "pricing"];
    await fireAndFlushCoalesced(live, "text-block");

    expect(screen.getByText("pricing")).toBeTruthy();
  });

  test("Provider subscription is properly cleaned up on re-fire + unmount (no leak)", async () => {
    // Every subscribe() returns a cleanup function. Invariant: at most ONE
    // subscription may be active at any time. Before an SSE re-fire, the
    // previous subscription must be removed; otherwise subscriptions
    // accumulate and leak. Unmount must clean up the final subscription.
    // Today every provider returns a no-op cleanup; this test guards the first
    // one with real teardown. active() rather than fixed counts keeps this robust against
    // StrictMode double mounting.
    let subscribes = 0;
    let unsubscribes = 0;
    const active = (): number => subscribes - unsubscribes;
    const provider: TreeChildrenSubscribe = () => (emit) => {
      subscribes += 1;
      emit([pageLeaf("apex")]);
      return () => {
        unsubscribes += 1;
      };
    };
    const live = controllableLiveEvents();
    let r: ReturnType<typeof render> | undefined;
    await act(async () => {
      r = renderDynamic({
        schema: dynamicSchema(),
        providers: new Map([["cms:nav:content", provider]]),
        entities: new Map([["cms:nav:content", ["text-block"]]]),
        live: live.subscribe,
      });
    });
    expect(active()).toBe(1); // exactly one active subscription after mount

    const before = subscribes;
    await fireAndFlushCoalesced(live, "text-block");
    expect(subscribes).toBeGreaterThan(before); // Re-Fire hat neu subscribed
    expect(active()).toBe(1); // …but the old one was removed first, so only one remains

    await act(async () => {
      r?.unmount();
    });
    expect(active()).toBe(0); // Unmount removes everything, so there is no leak
  });
});

describe("NavTree live refresh coalescing", () => {
  test("a burst of entity events re-subscribes the provider once and keeps the nodes on screen", async () => {
    let subscribes = 0;
    const provider: TreeChildrenSubscribe = () => (emit) => {
      subscribes += 1;
      emit([pageLeaf("apex")]);
      return () => {};
    };
    const live = controllableLiveEvents();
    await act(async () => {
      renderDynamic({
        schema: dynamicSchema(),
        providers: new Map([["cms:nav:content", provider]]),
        entities: new Map([["cms:nav:content", ["text-block"]]]),
        live: live.subscribe,
      });
    });
    const before = subscribes;

    await fireAndFlushCoalesced(live, "text-block", 5);

    expect(subscribes).toBe(before + 1);
    expect(screen.getByText("apex")).toBeTruthy();
  });
});

// The actions container clears the collapse chevron via `right-7`.
// A node without a chevron (not expandable) has no chevron — the narrower
// `right-1` spacing must only apply there.
describe("NavTree Actions-Positionierung", () => {
  test("Expandable node (with Chevron) keeps the wide right-7 spacing", async () => {
    const provider: TreeChildrenSubscribe = () => (emit) => {
      emit([pageLeaf("apex")]);
      return () => {};
    };
    await act(async () => {
      renderDynamic({
        schema: dynamicSchema(),
        providers: new Map([["cms:nav:content", provider]]),
      });
    });

    const btn = screen.getByRole("button", { name: "New page" });
    const actionsContainer = btn.parentElement;
    expect(actionsContainer?.className).toContain("right-7");
    expect(actionsContainer?.className).not.toContain("right-1");
  });

  test("Non-expandable node (no Chevron) shifts to right-1", async () => {
    const schema: FeatureSchema = {
      featureName: "cms",
      entities: {},
      screens: [{ id: "hero", type: "entityList", entity: "item", columns: [] }],
      navs: [
        {
          id: "hero",
          label: "Hero",
          order: 10,
          screen: "hero",
          createAction: {
            icon: "plus",
            label: "New sub-page",
            target: { featureId: "cms", action: "create", args: {} },
          },
        },
      ],
    } satisfies FeatureSchema;
    await act(async () => {
      renderDynamic({ schema, providers: new Map() });
    });

    const btn = screen.getByRole("button", { name: "New sub-page" });
    const actionsContainer = btn.parentElement;
    expect(actionsContainer?.className).toContain("right-1");
    expect(actionsContainer?.className).not.toContain("right-7");
  });
});

describe("NavTree Suchfeld", () => {
  // The search field is the only <input> in the tree; use its role instead of
  // the i18n placeholder because the local i18n bundle may not contain the
  // new key, while CI does.

  test("Filter hides non-matches, keeps matches + their ancestors", () => {
    render(<NavTree schema={makeSchema()} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "active" } });

    // The match itself remains visible (case-insensitive).
    expect(screen.getByText("Active")).toBeTruthy();
    // Nicht-Treffer-Geschwister weg.
    expect(screen.queryByText("Backlog")).toBeNull();
    // Ancestors remain so the matching item stays reachable.
    expect(screen.getByText("Items")).toBeTruthy();
    expect(screen.getByText("Data")).toBeTruthy();
  });

  test("Filter with no matches clears the tree; clearing it restores everything", () => {
    render(<NavTree schema={makeSchema()} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "zzz-nichts" } });
    expect(screen.queryByText("Items")).toBeNull();
    expect(screen.queryByText("Data")).toBeNull();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Backlog")).toBeTruthy();
    expect(screen.getByText("Data")).toBeTruthy();
  });
});

describe("NavTree folder-open Icon", () => {
  test("Folder node shows folder-open when expanded, folder when collapsed", async () => {
    const provider: TreeChildrenSubscribe = () => (emit) => {
      emit([{ label: "page", icon: "folder", children: [pageLeaf("hero")] }]);
      return () => {};
    };
    let container: HTMLElement | undefined;
    await act(async () => {
      container = renderDynamic({
        schema: dynamicSchema(),
        providers: new Map([["cms:nav:content", provider]]),
      }).container;
    });
    // Initially expanded → open-folder icon, not closed-folder icon.
    expect(container?.querySelector(".lucide-folder-open")).toBeTruthy();
    expect(container?.querySelector(".lucide-folder")).toBeNull();

    // The only aria-labeled chevron belongs to the "page" subfolder
    // (the provider container toggles inline without an aria label).
    const chevron = screen.getByRole("button", { name: /Expand|Collapse/ });
    await act(async () => {
      fireEvent.click(chevron);
    });
    expect(container?.querySelector(".lucide-folder")).toBeTruthy();
    expect(container?.querySelector(".lucide-folder-open")).toBeNull();
  });
});

describe("NavTree top-level runs", () => {
  function makeRunSchema(): FeatureSchema {
    return {
      featureName: "runs",
      entities: {},
      screens: ["one", "two", "inside", "three"].map((id) => ({
        id,
        type: "entityList" as const,
        entity: "x",
        columns: [],
      })),
      navs: [
        { id: "one", label: "One", screen: "one", order: 10 },
        { id: "two", label: "Two", screen: "two", order: 20 },
        { id: "section", label: "Section", order: 30 },
        { id: "inside", label: "Inside", parent: "section", screen: "inside", order: 10 },
        { id: "three", label: "Three", screen: "three", order: 40 },
        { id: "content", label: "Content", order: 50, provider: true },
      ],
    } satisfies FeatureSchema;
  }

  function menuLists(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('ul[data-sidebar="menu"]'));
  }

  function listOf(label: string): HTMLElement | null {
    return screen.getByText(label).closest<HTMLElement>('ul[data-sidebar="menu"]');
  }

  test("consecutive leaves share one list, a section splits the runs", () => {
    const { container } = render(<NavTree schema={makeRunSchema()} />);

    expect(menuLists(container)).toHaveLength(3);
    expect(listOf("One")).toBe(listOf("Two"));
    expect(listOf("Inside")).not.toBe(listOf("One"));
    expect(listOf("Three")).not.toBe(listOf("One"));
    expect(listOf("Three")).not.toBe(listOf("Inside"));
  });

  test("provider node sits in the same list as the leaf before it", () => {
    render(<NavTree schema={makeRunSchema()} />);

    expect(listOf("Content")).toBe(listOf("Three"));
  });

  test("a run whose entries are all filtered out leaves no list behind", () => {
    const { container } = render(<NavTree schema={makeRunSchema()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "inside" } });

    expect(screen.queryByText("One")).toBeNull();
    const emptyLists = menuLists(container).filter((ul) => ul.childElementCount === 0);
    expect(emptyLists.length).toBeGreaterThan(0);
    expect(emptyLists.every((ul) => ul.className.includes("empty:hidden"))).toBe(true);
    expect(menuLists(container).filter((ul) => ul.childElementCount > 0)).toHaveLength(1);
  });
});
