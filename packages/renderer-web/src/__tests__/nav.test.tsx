import { formatPath, NavProvider, parsePath, useNav } from "@cosmicdrift/kumiko-renderer";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test } from "bun:test";
import { KumikoLink, useBrowserNavApi } from "../app/nav";

describe("parsePath", () => {
  test("leerer Pfad / → undefined", () => {
    expect(parsePath("/")).toBeUndefined();
  });

  test("/<screenId> → { screenId }", () => {
    expect(parsePath("/task-list")).toEqual({ screenId: "task-list" });
  });

  test("/<screenId>/<entityId> → { screenId, entityId }", () => {
    expect(parsePath("/task-edit/abc-123")).toEqual({
      screenId: "task-edit",
      entityId: "abc-123",
    });
  });

  test("trailing-slash wird toleriert", () => {
    expect(parsePath("/task-list/")).toEqual({ screenId: "task-list" });
  });

  test("zusätzliche segmente werden ignoriert (kein nested routing)", () => {
    expect(parsePath("/task-edit/abc-123/extra/segments")).toEqual({
      screenId: "task-edit",
      entityId: "abc-123",
    });
  });
});

describe("formatPath", () => {
  test("nur screenId", () => {
    expect(formatPath({ screenId: "task-list" })).toBe("/task-list");
  });

  test("screenId + entityId", () => {
    expect(formatPath({ screenId: "task-edit", entityId: "abc-123" })).toBe("/task-edit/abc-123");
  });

  test("workspaceId prefix bei Workspace-Mode", () => {
    expect(formatPath({ workspaceId: "admin", screenId: "task-list" })).toBe("/admin/task-list");
  });

  test("workspaceId + screenId + entityId", () => {
    expect(
      formatPath({ workspaceId: "dispatch", screenId: "order-edit", entityId: "abc-123" }),
    ).toBe("/dispatch/order-edit/abc-123");
  });
});

describe("parsePath — workspace mode", () => {
  test("/<workspaceId>/<screenId> → trägt beide", () => {
    expect(parsePath("/admin/task-list", true)).toEqual({
      workspaceId: "admin",
      screenId: "task-list",
    });
  });

  test("/<workspaceId>/<screenId>/<entityId> → mit entityId", () => {
    expect(parsePath("/admin/task-edit/abc-123", true)).toEqual({
      workspaceId: "admin",
      screenId: "task-edit",
      entityId: "abc-123",
    });
  });

  test("/<workspaceId> ohne screen → screenId leer (caller resolved Default)", () => {
    expect(parsePath("/admin", true)).toEqual({ workspaceId: "admin", screenId: "" });
  });

  test("/ → undefined auch im Workspace-Mode", () => {
    expect(parsePath("/", true)).toBeUndefined();
  });
});

// Wrapper der das web-spezifische useBrowserNavApi aufruft und in
// einen shared-NavProvider durchreicht. Das ist genau das was
// createKumikoApp intern macht.
function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const api = useBrowserNavApi();
  return <NavProvider value={api}>{children}</NavProvider>;
}

describe("useBrowserNavApi + NavProvider", () => {
  beforeEach(() => {
    // jsdom teilt window.history zwischen Tests — auf / zurücksetzen,
    // sonst leaken Routen aus vorigen Tests in die nächsten.
    window.history.replaceState(null, "", "/");
  });

  function Probe(): React.ReactElement {
    const nav = useNav();
    return (
      <div>
        <span data-testid="screen-id">{nav.route?.screenId ?? "(none)"}</span>
        <span data-testid="entity-id">{nav.route?.entityId ?? "(none)"}</span>
        <button
          type="button"
          data-testid="go-list"
          onClick={() => nav.navigate({ screenId: "task-list" })}
        >
          go-list
        </button>
        <button
          type="button"
          data-testid="go-edit"
          onClick={() => nav.navigate({ screenId: "task-edit", entityId: "xyz" })}
        >
          go-edit
        </button>
        <button
          type="button"
          data-testid="replace-list"
          onClick={() => nav.replace({ screenId: "task-list" })}
        >
          replace-list
        </button>
      </div>
    );
  }

  test("initial-route aus window.location.pathname", async () => {
    window.history.replaceState(null, "", "/task-list");
    render(
      <BrowserNav>
        <Probe />
      </BrowserNav>,
    );
    await act(async () => {});
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
    expect(screen.getByTestId("entity-id").textContent).toBe("(none)");
  });

  test("navigate() aktualisiert location + re-rendert", async () => {
    render(
      <BrowserNav>
        <Probe />
      </BrowserNav>,
    );
    await act(async () => {});
    expect(screen.getByTestId("screen-id").textContent).toBe("(none)");

    act(() => {
      fireEvent.click(screen.getByTestId("go-edit"));
    });

    expect(window.location.pathname).toBe("/task-edit/xyz");
    expect(screen.getByTestId("screen-id").textContent).toBe("task-edit");
    expect(screen.getByTestId("entity-id").textContent).toBe("xyz");
  });

  test("replace() aktualisiert location ohne History-Eintrag", async () => {
    render(
      <BrowserNav>
        <Probe />
      </BrowserNav>,
    );
    await act(async () => {});
    expect(screen.getByTestId("screen-id").textContent).toBe("(none)");
    const before = window.history.length;
    act(() => {
      fireEvent.click(screen.getByTestId("replace-list"));
    });
    expect(window.location.pathname).toBe("/task-list");
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
    // Das ist der Unterschied zu navigate(): keine zusätzliche History-
    // Stufe. Browser-Back springt damit zur Origin-Seite zurück, nicht
    // auf die alte URL — wichtig für Mount-Time URL-Fills wie in
    // WorkspaceShell, wo der User die alte URL nie gewählt hat.
    expect(window.history.length).toBe(before);
  });

  test("popstate (Browser-Back) re-rendert die aktuelle Route", async () => {
    render(
      <BrowserNav>
        <Probe />
      </BrowserNav>,
    );
    await act(async () => {});
    act(() => {
      fireEvent.click(screen.getByTestId("go-list"));
    });
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");

    // Simulate Back-Button: history.replaceState statt back() — jsdom's
    // back() feuert nicht immer synchron popstate. Wir dispatchen das
    // Event manuell, genau wie es der Browser tun würde.
    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("screen-id").textContent).toBe("(none)");
  });
});

describe("KumikoLink", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("rendert <a> mit korrekter href", async () => {
    render(
      <BrowserNav>
        <KumikoLink to={{ screenId: "task-edit", entityId: "xyz" }}>Edit</KumikoLink>
      </BrowserNav>,
    );
    await act(async () => {});
    const anchor = screen.getByText("Edit") as HTMLAnchorElement;
    expect(anchor.tagName).toBe("A");
    expect(anchor.getAttribute("href")).toBe("/task-edit/xyz");
  });

  test("left-click wird abgefangen → navigate() statt full reload", async () => {
    render(
      <BrowserNav>
        <KumikoLink to={{ screenId: "task-list" }}>Liste</KumikoLink>
      </BrowserNav>,
    );
    await act(async () => {});
    act(() => {
      fireEvent.click(screen.getByText("Liste"), { button: 0 });
    });
    expect(window.location.pathname).toBe("/task-list");
  });

  test("meta-click (Cmd/Ctrl) wird NICHT abgefangen — Browser öffnet in neuem Tab", async () => {
    render(
      <BrowserNav>
        <KumikoLink to={{ screenId: "task-list" }}>Liste</KumikoLink>
      </BrowserNav>,
    );
    await act(async () => {});
    const anchor = screen.getByText("Liste") as HTMLAnchorElement;
    let kumikoLinkPreventedDefault: boolean | undefined;
    const observer = (e: Event) => {
      kumikoLinkPreventedDefault = e.defaultPrevented;
      e.preventDefault(); // silence jsdom nav
    };
    anchor.addEventListener("click", observer);
    try {
      act(() => {
        anchor.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
            metaKey: true,
          }),
        );
      });
    } finally {
      anchor.removeEventListener("click", observer);
    }
    expect(kumikoLinkPreventedDefault).toBe(false);
  });
});
