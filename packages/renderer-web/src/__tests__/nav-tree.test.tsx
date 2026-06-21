//
// NavTree: Sidebar-Navigation aus dem Schema. Pinnt zwei Verträge:
//   1. Section-Header (parent ohne screen) plus children-Collapse
//      via Chevron-Click — State lokal im NavTree.
//   2. Active-State greift auf node mit screen wenn nav.route's
//      screenId matcht (Standard-Sidebar-Verhalten).

import { afterEach, describe, expect, test } from "bun:test";
import type {
  TargetRef,
  TreeChildrenSubscribe,
  TreeNode,
} from "@cosmicdrift/kumiko-framework/engine";
import type { FeatureSchema, LiveEventSubscriber } from "@cosmicdrift/kumiko-renderer";
import { LiveEventsProvider } from "@cosmicdrift/kumiko-renderer";
import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import { NavProvidersProvider } from "../app/nav-providers-context";
import { NavTree } from "../layout/nav-tree";
import { setDispatchListener } from "../layout/target-resolver-stub";
import { fireEvent, renderWithSidebar as render, screen } from "./test-utils";

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
      // Section ohne Screen mit children — togglebar (Variant 2)
      { id: "data", label: "Data", order: 10 },
      // Parent mit Screen UND children — Link + separater Chevron (Variant 1)
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
  } as FeatureSchema;
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
      // Public — keine access-rule, sichtbar für alle (auch anonymous)
      { id: "public", label: "Public", screen: "public-screen", order: 10 },
      // Admin — nur User mit "Admin"-Rolle
      {
        id: "admin",
        label: "Admin",
        screen: "admin-screen",
        order: 20,
        access: { roles: ["Admin"] },
      },
      // Sysadmin — nur User mit "SystemAdmin"-Rolle
      {
        id: "sysadmin",
        label: "Sysadmin",
        screen: "sysadmin-screen",
        order: 30,
        access: { roles: ["SystemAdmin"] },
      },
    ],
  } as FeatureSchema;
}

describe("NavTree role-gating", () => {
  // Pinnt den prod-bug aus 2026-05-02: DefaultAppShell hat user-prop
  // nicht durchgereicht → resolveNavigation sieht user=undefined →
  // ALLE role-gated nav-einträge werden ausgeblendet (auch wenn der
  // user de-facto die Rolle hat).

  test("user mit ['SystemAdmin','User'] sieht public + sysadmin, NICHT admin", () => {
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

  test("user mit ['Admin'] sieht public + admin, NICHT sysadmin", () => {
    render(<NavTree schema={makeRoleGatedSchema()} user={{ id: "u1", roles: ["Admin"] }} />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.queryByText("Sysadmin")).toBeNull();
  });

  test("OHNE user-prop (anonymous) → role-gated navs ausgeblendet, nur public sichtbar", () => {
    // Genau das Verhalten das den prod-bug verursacht hat: wenn
    // DefaultAppShell user nicht weiterreicht, sieht resolveNavigation
    // anonymous → alle role-gated navs verschwinden.
    render(<NavTree schema={makeRoleGatedSchema()} />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("Sysadmin")).toBeNull();
  });

  test("multi-role-merge: user mit überlappenden rollen sieht beide", () => {
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

describe("NavTree", () => {
  test("Section-Header (parent ohne screen) ist statisches Label, children sichtbar", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    // Section "Data" ist eine STATISCHE Überschrift (sidebar-07-Muster), kein
    // Toggle-Button — Collapse gehört auf Items mit children, nicht die Section.
    expect(screen.getByText("Data")).toBeTruthy();
    expect(screen.getByText("Data").closest("button")).toBeNull();

    // Children sind sichtbar im DOM.
    expect(screen.getByText("Items")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Backlog")).toBeTruthy();
  });

  test("Section-Header collapst NICHT — children bleiben sichtbar", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    // Kein Section-Toggle: "Data" sitzt nicht in einem Button, es gibt nichts
    // zu klicken. Die Items bleiben dauerhaft sichtbar.
    expect(screen.getByText("Data").closest("button")).toBeNull();
    expect(screen.getByText("Items")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  test("Parent mit Screen + children — Chevron-Click toggled, ohne Navigation", () => {
    render(<NavTree schema={makeSchema()} testId="tree" />);

    // "Items" hat children Active+Backlog; default expanded
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Backlog")).toBeTruthy();

    // Section-Header "Data" ist ein einziger Toggle-Button (kein nested
    // chevron-button drin). Parent-mit-Screen "Items" rendert dagegen den
    // KumikoLink + separaten Chevron-Button als Geschwister — der ist
    // der EINZIGE button mit aria-label "Zuklappen"/"Aufklappen".
    // aria-Label kommt aus dem Framework-Default-Bundle. Test-Setup
    // läuft auf "en" → "Expand"/"Collapse". Apps können das in eigenen
    // Bundles per `kumiko.nav.*` überschreiben.
    const chevronButtons = screen.getAllByRole("button", { name: /Expand|Collapse/ });
    expect(chevronButtons.length).toBe(1);
    fireEvent.click(chevronButtons[0] as HTMLButtonElement);

    // Items ist jetzt collapsed; Active/Backlog weg
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Backlog")).toBeNull();
    // Items selbst bleibt sichtbar
    expect(screen.getByText("Items")).toBeTruthy();
  });

  test("Nav-Eintrag mit bekanntem icon rendert ein Lucide-Icon, ohne icon den Dot", () => {
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
    } as FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    // Flache Navigation ohne Sections → keine Chevrons. Genau EIN svg:
    // das dashboard-Icon. Das icon-lose Item rendert den Dot (span, kein svg).
    expect(container.querySelectorAll("svg").length).toBe(1);
  });

  test("layers + building (money-horse Kredit-Gruppen/Mandanten) lösen auf ein Icon auf", () => {
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
    } as FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    expect(container.querySelectorAll("svg").length).toBe(2);
  });

  test("unbekannter icon-Key fällt sauber auf den Dot zurück (kein svg)", () => {
    const schema = {
      featureName: "showcase",
      entities: {},
      screens: [{ id: "x", type: "entityList", entity: "x", columns: [] }],
      navs: [{ id: "x", label: "X", screen: "x", order: 10, icon: "does-not-exist" }],
    } as FeatureSchema;
    const { container } = render(<NavTree schema={schema} />);
    expect(container.querySelectorAll("svg").length).toBe(0);
  });
});

describe("NavTree navBadges (Runtime-Badge-Slot)", () => {
  // Tier-Badge & Co: die App liefert per bare nav-id einen ReactNode (Wert
  // UND Farbe). Gekeyt auf lastSegment(qualifiedName) → die App schreibt
  // "tarif", nicht "showcase:nav:tarif".
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
    } as FeatureSchema;
  }

  test("Badge gekeyt auf bare nav-id sitzt im passenden Item, nicht in anderen", () => {
    render(<NavTree schema={flatSchema()} navBadges={new Map([["tarif", <span>Pro</span>]])} />);
    const badge = screen.getByText("Pro");
    expect(screen.getByText("Tarif & Limits").closest("li")?.textContent).toContain("Pro");
    expect(screen.getByText("Plain").closest("li")?.textContent).not.toContain("Pro");
    // Slot-Wrapper schiebt rechts (ml-auto), Badge selbst shrinkt nicht weg.
    expect(badge.parentElement?.className).toContain("ml-auto");
  });

  test("ohne navBadges → kein Badge-Slot", () => {
    render(<NavTree schema={flatSchema()} />);
    expect(screen.queryByText("Pro")).toBeNull();
  });

  test("Key ohne passendes Item → nichts (silent), übrige Items rendern normal", () => {
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

// ── Visual-Tree-Merge: dynamische Knoten in der EINEN Nav ──────────────
//
// Beweist die vier Caps die NavTree aus dem alten VisualTree übernimmt:
// target-Dispatch, lazy Provider-Children, createAction (+), und — der
// kritische Pfad — der SSE-treeEntities-Refresh, der neue Knoten LIVE in
// die Nav bringt (sonst lädt der Tree einmal und „+pricing" erscheint nie).

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
      // Die Consumer-cbs (NavTree, prod) ignorieren das Event-Arg → zero-arg
      // call genügt; Cast überbrückt nur die Param-Signatur.
      for (const cb of listeners.get(entity) ?? []) (cb as () => void)();
    },
  };
}

function pageLeaf(slug: string): TreeNode {
  return { label: slug, target: { featureId: "cms", action: "edit", args: { slug } } };
}

// Provider mit `provider: true`-Knoten "Content" + „+"-createAction. QN =
// "cms:nav:content" (featureName:nav:id). Der Provider liefert die Children.
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
  } as FeatureSchema;
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
  // Eigene (kontrollierbare) LiveEventsProvider überschreibt den No-op aus
  // den DefaultProviders (nächster Provider gewinnt).
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

  test("provider:true-Knoten lädt seine Children lazy + rendert sie (default-expanded)", async () => {
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

  test("createAction rendert ein Plus-Button der sein target dispatcht", async () => {
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

  test("target-Knoten dispatcht beim Klick (statt Route-Link)", async () => {
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
    } as FeatureSchema;
    await act(async () => {
      renderDynamic({ schema, providers: new Map() });
    });

    fireEvent.click(screen.getByText("Hero"));
    expect(dispatched).toEqual({ featureId: "cms", action: "edit", args: { slug: "hero" } });
  });

  test("SSE-treeEntities-Refresh bringt neu erstellte Knoten LIVE in die Nav", async () => {
    // Der eigentliche Kern: ein text-block-Event re-fired den Provider →
    // die frisch erstellte Seite („pricing") erscheint, ohne Re-Mount.
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

    // Neue Seite angelegt → text-block-Event feuert → Provider re-fired.
    pages = ["apex", "hero", "pricing"];
    await act(async () => {
      live.fire("text-block");
    });

    expect(screen.getByText("pricing")).toBeTruthy();
  });

  test("Provider-Subscription wird beim Re-Fire + Unmount sauber abgebaut (kein Leak)", async () => {
    // Jeder subscribe() liefert eine cleanup-Funktion. Invariante: zu jedem
    // Zeitpunkt darf höchstens EINE Subscription aktiv sein. Beim SSE-Re-Fire
    // muss die vorherige abgebaut werden BEVOR neu subscribed wird (sonst
    // akkumulieren sie = Leak); beim Unmount läuft die letzte cleanup. Heute
    // liefern alle Provider no-op-cleanup — dieser Test schützt den ersten
    // mit echtem Teardown. (active() statt fixer Counts → robust gegen
    // StrictMode-Doppel-Mount: net bleibt eine aktive Subscription.)
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
    expect(active()).toBe(1); // genau eine aktive Subscription nach Mount

    const before = subscribes;
    await act(async () => {
      live.fire("text-block");
    });
    expect(subscribes).toBeGreaterThan(before); // Re-Fire hat neu subscribed
    expect(active()).toBe(1); // …aber die alte vorher abgebaut → weiterhin eine

    await act(async () => {
      r?.unmount();
    });
    expect(active()).toBe(0); // Unmount baut alles ab → kein Leak
  });
});
