// @vitest-environment jsdom

import type { TreeChildrenSubscribe, TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TreeProvidersProvider } from "../../app/tree-providers-context";
import { setDispatchListener } from "../target-resolver-stub";
import { VisualTree } from "../visual-tree";

// Mock-Provider-Helper. emit wird einmal initial gerufen mit den
// gegebenen Nodes; cleanup ist no-op. Subscriptions können später
// auch dynamisch sein (siehe `makeMutableProvider`).
function makeStaticProvider(nodes: readonly TreeNode[]): TreeChildrenSubscribe {
  return () => (emit) => {
    emit(nodes);
    return () => {};
  };
}

// Mutable-Provider — Test kann via `emitFn` einen weiteren Emit
// auslösen um Subscribe-Update zu beweisen. Returnt ein Tupel
// [provider, controls].
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

function renderTree(
  providers: ReadonlyMap<string, TreeChildrenSubscribe>,
): ReturnType<typeof render> {
  function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <TreeProvidersProvider value={providers}>{children}</TreeProvidersProvider>;
  }
  return render(<VisualTree workspaceId="test-ws" />, { wrapper: Wrapper });
}

// vitest+Bun-Runtime liefert nur ein partielles localStorage (kein
// `clear`/`removeItem`). Wir installieren pro Test einen frischen
// Map-basierten Mock, damit Standard-API-Methoden funktionieren und
// Test-Isolation sauber ist. Production-Code nutzt nur die Standard-
// Schnittstelle, daher transparent.
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
});

describe("VisualTree — Empty-State", () => {
  test("ohne registrierte Provider rendert sichtbaren Empty-Hint", () => {
    renderTree(new Map());
    expect(screen.getByLabelText("Visual Tree (no providers)")).toBeTruthy();
    expect(screen.getByText(/Keine Tree-Provider aktiv/)).toBeTruthy();
  });

  test("Provider-Map vorhanden + emittet leere TreeNode[]: kein Empty-State, kein NavTree-Fallback", () => {
    const providers = new Map([["text-content", makeStaticProvider([])]]);
    renderTree(providers);
    // Nicht im Empty-State (es gibt einen registrierten Provider, der
    // hat nur kein Knoten emittet). Stattdessen rendert die ProviderBranch
    // mit dem featureName als Label im aria-tree.
    expect(screen.queryByLabelText("Visual Tree (no providers)")).toBeNull();
    expect(screen.getByLabelText("Visual Tree")).toBeTruthy();
  });
});

describe("VisualTree — Provider-Iteration", () => {
  test("Single-Provider mit static-children rendert Top-Level-Knoten", () => {
    const providers = new Map([
      ["text-content", makeStaticProvider([{ label: "Marketing" }, { label: "Legal" }])],
    ]);
    renderTree(providers);
    expect(screen.getByText("Marketing")).toBeTruthy();
    expect(screen.getByText("Legal")).toBeTruthy();
  });

  test("Multi-Provider alphabetisch sortiert nach featureName", () => {
    // legal-pages kommt alphabetisch vor text-content
    const providers = new Map<string, TreeChildrenSubscribe>([
      ["text-content", makeStaticProvider([{ label: "Marketing" }])],
      ["legal-pages", makeStaticProvider([{ label: "Imprint" }])],
    ]);
    renderTree(providers);
    const branches = document.querySelectorAll("[data-kumiko-tree-branch]");
    expect(branches[0]?.getAttribute("data-kumiko-tree-branch")).toBe("legal-pages");
    expect(branches[1]?.getAttribute("data-kumiko-tree-branch")).toBe("text-content");
  });

  test("Provider der nicht emittet bleibt im loading-State sichtbar", () => {
    // Provider ruft emit nie auf (z.B. async-fetch noch im Flug)
    const noopProvider: TreeChildrenSubscribe = () => () => () => {};
    const providers = new Map([["slow-feature", noopProvider]]);
    renderTree(providers);
    expect(screen.getByText("slow-feature: lädt …")).toBeTruthy();
  });

  test("Subscribe-Update: zweiter Emit re-rendert die Liste", () => {
    const { provider, emit } = makeMutableProvider([{ label: "Hero" }]);
    const providers = new Map([["text-content", provider]]);
    renderTree(providers);

    expect(screen.getByText("Hero")).toBeTruthy();

    // Provider emittet aktualisierte Liste — Tree muss re-rendern.
    // act() wrapped den state-Update damit React synchronisiert flushed.
    act(() => {
      emit([{ label: "Hero" }, { label: "Pricing" }]);
    });
    expect(screen.getByText("Pricing")).toBeTruthy();
    expect(screen.getByText("Hero")).toBeTruthy();
  });

  test("Provider-Unsubscribe wird beim Unmount gecallt", () => {
    let unsubscribed = false;
    const provider: TreeChildrenSubscribe = () => (emit) => {
      emit([{ label: "Foo" }]);
      return () => {
        unsubscribed = true;
      };
    };
    const providers = new Map([["test", provider]]);
    const result = renderTree(providers);

    expect(unsubscribed).toBe(false);
    result.unmount();
    expect(unsubscribed).toBe(true);
  });
});

describe("VisualTree — Click-Dispatch", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test("Click auf Knoten mit target ruft dispatchTarget mit dem TargetRef", () => {
    const dispatched: unknown[] = [];
    cleanup = setDispatchListener((target) => {
      dispatched.push(target);
    });

    const providers = new Map([
      [
        "text-content",
        makeStaticProvider([
          {
            label: "Hero",
            target: { featureId: "text-content", action: "edit", args: { slug: "hero" } },
          },
        ]),
      ],
    ]);
    renderTree(providers);

    fireEvent.click(screen.getByText("Hero"));

    expect(dispatched).toEqual([
      { featureId: "text-content", action: "edit", args: { slug: "hero" } },
    ]);
  });

  test("Click auf Container-Knoten (mit children) toggled expand statt Dispatch", () => {
    const dispatched: unknown[] = [];
    cleanup = setDispatchListener((target) => {
      dispatched.push(target);
    });

    const providers = new Map([
      [
        "text-content",
        makeStaticProvider([
          {
            label: "Marketing",
            children: [{ label: "Hero" }],
          },
        ]),
      ],
    ]);
    renderTree(providers);

    // Initial collapsed: Hero nicht sichtbar
    expect(screen.queryByText("Hero")).toBeNull();
    fireEvent.click(screen.getByText("Marketing"));
    // Nach Click expanded: Hero sichtbar, kein Dispatch passiert
    expect(screen.getByText("Hero")).toBeTruthy();
    expect(dispatched).toEqual([]);
  });
});

describe("VisualTree — localStorage-Persistenz", () => {
  test("Toggle persistiert expanded-Set ins localStorage pro Workspace", () => {
    const providers = new Map([
      ["text-content", makeStaticProvider([{ label: "Marketing", children: [{ label: "Hero" }] }])],
    ]);
    renderTree(providers);

    fireEvent.click(screen.getByText("Marketing"));

    const stored = window.localStorage.getItem("kumiko:visual-tree:expanded:test-ws");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? "[]") as string[];
    expect(parsed.length).toBe(1);
    expect(parsed[0]).toContain("Marketing");
  });

  test("Re-mount restored expanded-Set aus localStorage", () => {
    // Setup: persistierter expanded-Set für test-ws-Workspace
    window.localStorage.setItem(
      "kumiko:visual-tree:expanded:test-ws",
      JSON.stringify(["text-content/0-Marketing"]),
    );

    const providers = new Map([
      ["text-content", makeStaticProvider([{ label: "Marketing", children: [{ label: "Hero" }] }])],
    ]);
    renderTree(providers);

    // Marketing ist expandiert → Hero sichtbar ohne Click
    expect(screen.getByText("Hero")).toBeTruthy();
  });
});
