// @vitest-environment jsdom
//
// V.1.1-D Integration-Test — End-to-End-Beweis für die Schleife
// `clientFeatures.treeProvider → useTreeProviders → VisualTree →
// TreeNodeRenderer → Click → dispatchTarget`.
//
// Im Gegensatz zum visual-tree.test.tsx (isolierte VisualTree-Component
// mit Mock-Providers) mountet dieser Test den vollen WorkspaceShell mit
// zwei Workspaces (nav + tree) und zwei Tree-Provider-clientFeatures.
// Bewert wird:
//   1. Provider-Iteration: beide Top-Level-Knoten landen im DOM
//      (alphabetisch nach featureName)
//   2. Subscribe-Update: zweiter Emit eines Providers re-rendert die
//      Sidebar ohne Workspace-Switch
//   3. Stub-Dispatch: Click auf Knoten mit target ruft dispatch mit
//      richtigem TargetRef
//   4. Workspace-Switch: nav-Workspace zeigt NavTree, tree-Workspace
//      zeigt VisualTree mit beiden Provider-Beiträgen
//
// **Memory `[Kein Fake-Dispatcher]`-Note**: V.1.1 hat keine HTTP-Calls
// (Tree-Provider sind reine Client-Functions die nur ctx.tenantId
// lesen). Echtes setupTestStack kommt mit V.1.2 wenn text-content's
// Slug-Liste durch die Server-Pipeline geht.

import type { TreeChildrenSubscribe, TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import type { FeatureSchema, WorkspaceSchema } from "@cosmicdrift/kumiko-renderer";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  NavProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { useBrowserNavApi } from "../app/nav";
import { TreeProvidersProvider } from "../app/tree-providers-context";
import { setDispatchListener } from "../layout/target-resolver-stub";
import { WorkspaceShell } from "../layout/workspace-shell";
import { defaultPrimitives } from "../primitives";

// localStorage-Mock (vitest+Bun-Runtime liefert nur partielles
// localStorage). Pro Test frische Map damit Tests sauber isoliert sind.
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
      clear: (): void => store.clear(),
      get length(): number {
        return store.size;
      },
      key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
    },
  });
  window.history.replaceState(null, "", "/");
});

function ws(
  id: string,
  options: {
    label: string;
    isDefault?: boolean;
    navigation?: "nav" | "tree";
    navMembers?: readonly string[];
  },
): WorkspaceSchema {
  return {
    definition: {
      id,
      label: options.label,
      access: { openToAll: true },
      ...(options.isDefault === true && { default: true }),
      ...(options.navigation !== undefined && { navigation: options.navigation }),
    },
    navMembers: options.navMembers ?? [],
  };
}

function makeStaticProvider(nodes: readonly TreeNode[]): TreeChildrenSubscribe {
  return () => (emit) => {
    emit(nodes);
    return () => {};
  };
}

function makeMutableProvider(initial: readonly TreeNode[]): {
  readonly provider: TreeChildrenSubscribe;
  emit(nodes: readonly TreeNode[]): void;
} {
  let listener: ((nodes: readonly TreeNode[]) => void) | undefined;
  const provider: TreeChildrenSubscribe = () => (emit) => {
    listener = emit;
    emit(initial);
    return () => {
      listener = undefined;
    };
  };
  return {
    provider,
    emit(nodes) {
      if (listener !== undefined) listener(nodes);
    },
  };
}

function renderShellWithTreeProviders(
  schema: FeatureSchema,
  treeProviders: ReadonlyMap<string, TreeChildrenSubscribe>,
): ReturnType<typeof render> {
  function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    const nav = useBrowserNavApi({ hasWorkspaces: true });
    return (
      <LocaleProvider resolver={createStaticLocaleResolver()}>
        <PrimitivesProvider value={defaultPrimitives}>
          <NavProvider value={nav}>
            <TreeProvidersProvider value={treeProviders}>{children}</TreeProvidersProvider>
          </NavProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    );
  }
  return render(
    <WorkspaceShell brand={<div>Brand</div>} schema={schema} user={{ id: "u1", roles: [] }}>
      <div>content</div>
    </WorkspaceShell>,
    { wrapper: Wrapper },
  );
}

describe("V.1.1-D Integration — Provider-Iteration + Subscribe + Dispatch", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test("Provider-Iteration: beide Features landen im DOM, alphabetisch sortiert", () => {
    const schema = {
      featureName: "demo",
      entities: {},
      screens: [],
      navs: [],
      workspaces: [
        ws("visual", {
          label: "Visual",
          isDefault: true,
          navigation: "tree",
        }),
      ],
    } as const;

    const treeProviders = new Map<string, TreeChildrenSubscribe>([
      ["text-content", makeStaticProvider([{ label: "Marketing" }])],
      ["legal-pages", makeStaticProvider([{ label: "Imprint" }])],
    ]);

    renderShellWithTreeProviders(schema, treeProviders);

    expect(screen.getByText("Marketing")).toBeTruthy();
    expect(screen.getByText("Imprint")).toBeTruthy();

    // Reihenfolge: legal-pages (l < t) kommt vor text-content
    const branches = document.querySelectorAll("[data-kumiko-tree-branch]");
    expect(branches[0]?.getAttribute("data-kumiko-tree-branch")).toBe("legal-pages");
    expect(branches[1]?.getAttribute("data-kumiko-tree-branch")).toBe("text-content");
  });

  test("Subscribe-Update ohne Workspace-Switch: zweiter Emit re-rendert", () => {
    const { provider, emit } = makeMutableProvider([{ label: "Hero" }]);

    const schema = {
      featureName: "demo",
      entities: {},
      screens: [],
      navs: [],
      workspaces: [ws("visual", { label: "Visual", isDefault: true, navigation: "tree" })],
    } as const;

    const treeProviders = new Map([["text-content", provider]]);

    renderShellWithTreeProviders(schema, treeProviders);
    expect(screen.getByText("Hero")).toBeTruthy();

    act(() => {
      emit([{ label: "Hero" }, { label: "Pricing" }, { label: "Footer" }]);
    });

    expect(screen.getByText("Pricing")).toBeTruthy();
    expect(screen.getByText("Footer")).toBeTruthy();
  });

  test("Stub-Dispatch: Click → setDispatchListener-Spy bekommt richtige TargetRef", () => {
    const dispatched: unknown[] = [];
    cleanup = setDispatchListener((target) => {
      dispatched.push(target);
    });

    const schema = {
      featureName: "demo",
      entities: {},
      screens: [],
      navs: [],
      workspaces: [ws("visual", { label: "Visual", isDefault: true, navigation: "tree" })],
    } as const;

    const treeProviders = new Map<string, TreeChildrenSubscribe>([
      [
        "text-content",
        makeStaticProvider([
          {
            label: "Imprint",
            target: {
              featureId: "text-content",
              action: "edit",
              args: { slug: "imprint" },
            },
          },
        ]),
      ],
    ]);

    renderShellWithTreeProviders(schema, treeProviders);
    fireEvent.click(screen.getByText("Imprint"));

    expect(dispatched).toEqual([
      {
        featureId: "text-content",
        action: "edit",
        args: { slug: "imprint" },
      },
    ]);
  });

  test("Workspace-Switch: nav-Workspace zeigt NavTree, tree-Workspace zeigt VisualTree-Provider", () => {
    const schema = {
      featureName: "demo",
      entities: {},
      screens: [],
      navs: [{ id: "list", label: "Builder-List" }],
      workspaces: [
        ws("admin", {
          label: "Admin",
          isDefault: true,
          navigation: "nav",
          navMembers: ["demo:nav:list"],
        }),
        ws("visual", {
          label: "Visual",
          navigation: "tree",
        }),
      ],
    } as const;

    const treeProviders = new Map<string, TreeChildrenSubscribe>([
      ["text-content", makeStaticProvider([{ label: "Marketing" }])],
    ]);

    renderShellWithTreeProviders(schema, treeProviders);

    // Initial: admin-Workspace → NavTree mit "Builder-List"
    expect(screen.getByText("Builder-List")).toBeTruthy();
    expect(screen.queryByText("Marketing")).toBeNull();

    // Switch zu visual → VisualTree mit Provider-Beitrag
    fireEvent.click(screen.getByTestId("workspace-tab-visual"));
    expect(screen.getByText("Marketing")).toBeTruthy();
    expect(screen.queryByText("Builder-List")).toBeNull();

    // Zurück zu admin → NavTree wieder
    fireEvent.click(screen.getByTestId("workspace-tab-admin"));
    expect(screen.getByText("Builder-List")).toBeTruthy();
    expect(screen.queryByText("Marketing")).toBeNull();
  });

  test("localStorage-Persistenz: Toggle persistiert pro Workspace, Re-Mount restored", () => {
    const schema = {
      featureName: "demo",
      entities: {},
      screens: [],
      navs: [],
      workspaces: [ws("visual", { label: "Visual", isDefault: true, navigation: "tree" })],
    } as const;

    const treeProviders = new Map<string, TreeChildrenSubscribe>([
      ["text-content", makeStaticProvider([{ label: "Marketing", children: [{ label: "Hero" }] }])],
    ]);

    const result = renderShellWithTreeProviders(schema, treeProviders);

    // Initial collapsed: Hero nicht sichtbar
    expect(screen.queryByText("Hero")).toBeNull();

    // Toggle: Marketing ausklappen
    fireEvent.click(screen.getByText("Marketing"));
    expect(screen.getByText("Hero")).toBeTruthy();

    // localStorage hat den Persisted-State
    const stored = window.localStorage.getItem("kumiko:visual-tree:expanded:visual");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "[]")).toContain("text-content/0-Marketing");

    // Re-Mount mit gleichem Workspace → expanded restored
    result.unmount();
    renderShellWithTreeProviders(schema, treeProviders);
    expect(screen.getByText("Hero")).toBeTruthy();
  });
});
