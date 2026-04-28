// @vitest-environment jsdom
//
// useBrowserNavApi({ basePath }) — Read-Pfad strippt den Prefix vor
// parsePath, Write-Pfad prepend'd ihn vor pushState/replaceState/hrefFor.
// URLs außerhalb des basePath liefern route=undefined, kein Auto-Redirect.

import { NavProvider, useNav } from "@kumiko/renderer";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test } from "vitest";
import { KumikoLink, useBrowserNavApi } from "../app/nav";

function AdminBrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const api = useBrowserNavApi({ basePath: "/admin" });
  return <NavProvider value={api}>{children}</NavProvider>;
}

function Probe(): React.ReactElement {
  const nav = useNav();
  return (
    <div>
      <span data-testid="screen-id">{nav.route?.screenId ?? "(none)"}</span>
      <span data-testid="entity-id">{nav.route?.entityId ?? "(none)"}</span>
      <span data-testid="route-defined">{nav.route === undefined ? "out" : "in"}</span>
      <span data-testid="href-list">{nav.hrefFor({ screenId: "task-list" })}</span>
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

describe("useBrowserNavApi({ basePath: '/admin' })", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("Read: URL '/admin/task-list' → in-app route screenId='task-list'", () => {
    window.history.replaceState(null, "", "/admin/task-list");
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
    expect(screen.getByTestId("route-defined").textContent).toBe("in");
  });

  test("Read: URL '/admin' (genau basePath) → in-app route undefined (Root, kein screen)", () => {
    window.history.replaceState(null, "", "/admin");
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    // parsePath("/") returnt undefined, weil leerer Pfad keine route ist —
    // aber wir sind IN-app (route-defined='in' wäre falsch hier weil
    // parsePath die undefined-Antwort gibt). Prüfung über screen-id.
    expect(screen.getByTestId("screen-id").textContent).toBe("(none)");
  });

  test("Read: URL '/marketing/foo' (außerhalb basePath) → route=undefined, App rendert Out-State", () => {
    window.history.replaceState(null, "", "/marketing/foo");
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    expect(screen.getByTestId("route-defined").textContent).toBe("out");
    expect(screen.getByTestId("screen-id").textContent).toBe("(none)");
  });

  test("Write: navigate({ screenId: 'task-list' }) → URL '/admin/task-list'", () => {
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("go-list"));
    });
    expect(window.location.pathname).toBe("/admin/task-list");
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
  });

  test("Write: navigate mit entityId → '/admin/task-edit/xyz'", () => {
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("go-edit"));
    });
    expect(window.location.pathname).toBe("/admin/task-edit/xyz");
    expect(screen.getByTestId("screen-id").textContent).toBe("task-edit");
    expect(screen.getByTestId("entity-id").textContent).toBe("xyz");
  });

  test("Write: replace verhält sich symmetrisch", () => {
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("replace-list"));
    });
    expect(window.location.pathname).toBe("/admin/task-list");
  });

  test("hrefFor: KumikoLink rendert Anchor mit prepended basePath", () => {
    render(
      <AdminBrowserNav>
        <KumikoLink to={{ screenId: "task-list" }}>Liste</KumikoLink>
      </AdminBrowserNav>,
    );
    const anchor = screen.getByText("Liste") as HTMLAnchorElement;
    expect(anchor.getAttribute("href")).toBe("/admin/task-list");
  });

  test("hrefFor in Probe: in-app route → mit basePath prefix", () => {
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    expect(screen.getByTestId("href-list").textContent).toBe("/admin/task-list");
  });

  test("Round-trip: aus '/admin/task-edit/xyz' navigate zu '/task-list' → '/admin/task-list'", () => {
    window.history.replaceState(null, "", "/admin/task-edit/xyz");
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    expect(screen.getByTestId("screen-id").textContent).toBe("task-edit");

    act(() => {
      fireEvent.click(screen.getByTestId("go-list"));
    });
    expect(window.location.pathname).toBe("/admin/task-list");
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
  });
});

describe("useBrowserNavApi (basePath-Edge-Cases via API)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("basePath mit trailing slash wird normalisiert", () => {
    function NavWithTrailing({ children }: { readonly children: ReactNode }): ReactNode {
      const api = useBrowserNavApi({ basePath: "/admin/" });
      return <NavProvider value={api}>{children}</NavProvider>;
    }
    window.history.replaceState(null, "", "/admin/task-list");
    render(
      <NavWithTrailing>
        <Probe />
      </NavWithTrailing>,
    );
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
  });

  test("basePath ohne leading slash wird normalisiert", () => {
    function NavWithoutLeading({ children }: { readonly children: ReactNode }): ReactNode {
      const api = useBrowserNavApi({ basePath: "admin" });
      return <NavProvider value={api}>{children}</NavProvider>;
    }
    window.history.replaceState(null, "", "/admin/task-list");
    render(
      <NavWithoutLeading>
        <Probe />
      </NavWithoutLeading>,
    );
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
  });

  test("basePath='/' verhält sich wie kein basePath", () => {
    function NavWithRoot({ children }: { readonly children: ReactNode }): ReactNode {
      const api = useBrowserNavApi({ basePath: "/" });
      return <NavProvider value={api}>{children}</NavProvider>;
    }
    window.history.replaceState(null, "", "/task-list");
    render(
      <NavWithRoot>
        <Probe />
      </NavWithRoot>,
    );
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
    act(() => {
      fireEvent.click(screen.getByTestId("go-edit"));
    });
    expect(window.location.pathname).toBe("/task-edit/xyz");
  });

  test("Prefix-aber-nicht-Match: '/administrator' MATCHT NICHT '/admin'", () => {
    // /administrator startet zwar mit 'admin', aber nicht mit '/admin/' —
    // strict-segment-Boundary verhindert false positives wie diesen.
    window.history.replaceState(null, "", "/administrator/dashboard");
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    expect(screen.getByTestId("route-defined").textContent).toBe("out");
  });
});
