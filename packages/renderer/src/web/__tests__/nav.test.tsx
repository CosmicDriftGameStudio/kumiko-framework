import { beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { formatPath, NavProvider, parsePath, useNav } from "../../index.ts";
import { KumikoLink, useBrowserNavApi } from "../app/nav.tsx";

describe("parsePath", () => {
  test("empty path / → undefined", () => {
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

  test("trailing slash is tolerated", () => {
    expect(parsePath("/task-list/")).toEqual({ screenId: "task-list" });
  });

  test("additional segments are ignored (no nested routing)", () => {
    expect(parsePath("/task-edit/abc-123/extra/segments")).toEqual({
      screenId: "task-edit",
      entityId: "abc-123",
    });
  });
});

describe("formatPath", () => {
  test("screenId only", () => {
    expect(formatPath({ screenId: "task-list" })).toBe("/task-list");
  });

  test("screenId + entityId", () => {
    expect(formatPath({ screenId: "task-edit", entityId: "abc-123" })).toBe("/task-edit/abc-123");
  });

  test("workspaceId prefix in workspace mode", () => {
    expect(formatPath({ workspaceId: "admin", screenId: "task-list" })).toBe("/admin/task-list");
  });

  test("workspaceId + screenId + entityId", () => {
    expect(
      formatPath({ workspaceId: "dispatch", screenId: "order-edit", entityId: "abc-123" }),
    ).toBe("/dispatch/order-edit/abc-123");
  });
});

describe("parsePath — workspace mode", () => {
  test("/<workspaceId>/<screenId> → contains both", () => {
    expect(parsePath("/admin/task-list", true)).toEqual({
      workspaceId: "admin",
      screenId: "task-list",
    });
  });

  test("/<workspaceId>/<screenId>/<entityId> → with entityId", () => {
    expect(parsePath("/admin/task-edit/abc-123", true)).toEqual({
      workspaceId: "admin",
      screenId: "task-edit",
      entityId: "abc-123",
    });
  });

  test("/<workspaceId> without screen → screenId empty (caller resolves Default)", () => {
    expect(parsePath("/admin", true)).toEqual({ workspaceId: "admin", screenId: "" });
  });

  test("/ → undefined also in workspace mode", () => {
    expect(parsePath("/", true)).toBeUndefined();
  });
});

// Wrapper that calls the web-specific useBrowserNavApi and passes it
// through to a shared NavProvider. This is exactly what
// createKumikoApp does internally.
function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const api = useBrowserNavApi();
  return <NavProvider value={api}>{children}</NavProvider>;
}

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

describe("useBrowserNavApi + NavProvider", () => {
  beforeEach(() => {
    // jsdom shares window.history between tests, so reset it to /;
    // otherwise routes leak from earlier tests into later ones.
    window.history.replaceState(null, "", "/");
  });

  test("initial route from window.location.pathname", async () => {
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

  test("replace() updates location without a history entry", async () => {
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
    // Unlike navigate(), this adds no History entry. Browser Back therefore
    // returns to the origin page rather than the old URL — important for
    // mount-time URL fills such as in WorkspaceShell, where the user never
    // chose the old URL.
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

    // Simulate the Back button: use history.replaceState instead of back()
    // because jsdom's back() does not always fire popstate synchronously.
    // Dispatch the event manually, exactly as the browser would.
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

  test("renders <a> with correct href", async () => {
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

  test("left-click is intercepted → navigate() instead of full reload", async () => {
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

  test("meta-click (Cmd/Ctrl) is NOT intercepted — browser opens in new tab", async () => {
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
