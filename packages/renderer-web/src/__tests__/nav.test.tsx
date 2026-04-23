// @vitest-environment jsdom
import { formatPath, NavProvider, parsePath, useNav } from "@kumiko/renderer";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test } from "vitest";
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
      </div>
    );
  }

  test("initial-route aus window.location.pathname", () => {
    window.history.replaceState(null, "", "/task-list");
    render(
      <BrowserNav>
        <Probe />
      </BrowserNav>,
    );
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
    expect(screen.getByTestId("entity-id").textContent).toBe("(none)");
  });

  test("navigate() aktualisiert location + re-rendert", () => {
    render(
      <BrowserNav>
        <Probe />
      </BrowserNav>,
    );
    expect(screen.getByTestId("screen-id").textContent).toBe("(none)");

    act(() => {
      fireEvent.click(screen.getByTestId("go-edit"));
    });

    expect(window.location.pathname).toBe("/task-edit/xyz");
    expect(screen.getByTestId("screen-id").textContent).toBe("task-edit");
    expect(screen.getByTestId("entity-id").textContent).toBe("xyz");
  });

  test("popstate (Browser-Back) re-rendert die aktuelle Route", () => {
    render(
      <BrowserNav>
        <Probe />
      </BrowserNav>,
    );
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

  test("rendert <a> mit korrekter href", () => {
    render(
      <BrowserNav>
        <KumikoLink to={{ screenId: "task-edit", entityId: "xyz" }}>Edit</KumikoLink>
      </BrowserNav>,
    );
    const anchor = screen.getByText("Edit") as HTMLAnchorElement;
    expect(anchor.tagName).toBe("A");
    expect(anchor.getAttribute("href")).toBe("/task-edit/xyz");
  });

  test("left-click wird abgefangen → navigate() statt full reload", () => {
    render(
      <BrowserNav>
        <KumikoLink to={{ screenId: "task-list" }}>Liste</KumikoLink>
      </BrowserNav>,
    );
    act(() => {
      fireEvent.click(screen.getByText("Liste"), { button: 0 });
    });
    expect(window.location.pathname).toBe("/task-list");
  });

  test("meta-click (Cmd/Ctrl) wird NICHT abgefangen — Browser öffnet in neuem Tab", () => {
    render(
      <BrowserNav>
        <KumikoLink to={{ screenId: "task-list" }}>Liste</KumikoLink>
      </BrowserNav>,
    );
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
