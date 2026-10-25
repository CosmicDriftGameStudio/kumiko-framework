//
// useBrowserNavApi({ basePath }) — The read path strips the prefix before
// parsePath; the write path prepends it before pushState/replaceState/hrefFor.
// URLs outside basePath produce route=undefined without an automatic redirect.
//
// This file is also the working recipe for basePath: every use case where an
// app author mounts an app under a prefix (an admin area under /admin, an
// embedded app under /embed, or workspace routing under a prefix) is exercised
// here with example URLs.

import { beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { NavProvider, useNav } from "../../index.ts";
import { KumikoLink, useBrowserNavApi } from "../app/nav.tsx";

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

  test("Read: URL '/admin' (exact basePath) → in-app route undefined (Root, no screen)", () => {
    window.history.replaceState(null, "", "/admin");
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    // parsePath("/") returns undefined because an empty path is not a route —
    // but we are IN-app (route-defined='in' would be wrong here because
    // parsePath returns undefined). Check this through screen-id.
    expect(screen.getByTestId("screen-id").textContent).toBe("(none)");
  });

  test("Read: URL '/marketing/foo' (outside basePath) → route=undefined, App renders Out-State", () => {
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

  test("Write: navigate with entityId → '/admin/task-edit/xyz'", () => {
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

  test("Write: replace behaves symmetrically", () => {
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

  test("hrefFor: KumikoLink renders an anchor with prepended basePath", () => {
    render(
      <AdminBrowserNav>
        <KumikoLink to={{ screenId: "task-list" }}>Liste</KumikoLink>
      </AdminBrowserNav>,
    );
    const anchor = screen.getByText("Liste") as HTMLAnchorElement;
    expect(anchor.getAttribute("href")).toBe("/admin/task-list");
  });

  test("hrefFor in Probe: in-app route → with basePath prefix", () => {
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

  test("basePath with trailing slash is normalized", () => {
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

  test("basePath without leading slash is normalized", () => {
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

  test("basePath='/' behaves like no basePath", () => {
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

  test("Prefix but not a match: '/administrator' does NOT MATCH '/admin'", () => {
    // /administrator starts with 'admin' but not with '/admin/' —
    // the strict segment boundary prevents false positives like this.
    window.history.replaceState(null, "", "/administrator/dashboard");
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    expect(screen.getByTestId("route-defined").textContent).toBe("out");
  });
});

describe("useBrowserNavApi({ basePath }) — Browser-History-Integration", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("popstate (Browser Back) re-renders with stripped route", () => {
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("go-edit"));
    });
    expect(screen.getByTestId("screen-id").textContent).toBe("task-edit");
    expect(window.location.pathname).toBe("/admin/task-edit/xyz");

    // Simulate Browser-Back to the app root: the URL falls back to /admin,
    // and popstate fires. The hook must strip and parse again.
    act(() => {
      window.history.replaceState(null, "", "/admin");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("screen-id").textContent).toBe("(none)");
  });

  test("popstate leaving the app area → route becomes out-of-app", () => {
    window.history.replaceState(null, "", "/admin/task-list");
    render(
      <AdminBrowserNav>
        <Probe />
      </AdminBrowserNav>,
    );
    expect(screen.getByTestId("route-defined").textContent).toBe("in");

    act(() => {
      window.history.replaceState(null, "", "/marketing");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("route-defined").textContent).toBe("out");
  });
});

describe("useBrowserNavApi({ basePath }) — searchParams orthogonality", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  function SearchProbe(): React.ReactElement {
    const nav = useNav();
    return (
      <div>
        <span data-testid="filter">{nav.searchParams["filter"] ?? "(none)"}</span>
        <button
          type="button"
          data-testid="set-filter"
          onClick={() => nav.setSearchParams({ filter: "open" })}
        >
          set
        </button>
      </div>
    );
  }

  test("Read: ?filter=open under '/admin/task-list' is read, not affected by basePath", () => {
    window.history.replaceState(null, "", "/admin/task-list?filter=open");
    render(
      <AdminBrowserNav>
        <SearchProbe />
      </AdminBrowserNav>,
    );
    expect(screen.getByTestId("filter").textContent).toBe("open");
  });

  test("Write: setSearchParams keeps basePath in the URL path", () => {
    window.history.replaceState(null, "", "/admin/task-list");
    render(
      <AdminBrowserNav>
        <SearchProbe />
      </AdminBrowserNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("set-filter"));
    });
    // The path retains the basePath prefix, and ?filter is appended.
    expect(window.location.pathname).toBe("/admin/task-list");
    expect(window.location.search).toBe("?filter=open");
  });
});

describe("useBrowserNavApi({ basePath, hasWorkspaces })", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  function WorkspaceAdminNav({ children }: { readonly children: ReactNode }): ReactNode {
    const api = useBrowserNavApi({ basePath: "/admin", hasWorkspaces: true });
    return <NavProvider value={api}>{children}</NavProvider>;
  }

  function WorkspaceProbe(): React.ReactElement {
    const nav = useNav();
    return (
      <div>
        <span data-testid="workspace-id">{nav.route?.workspaceId ?? "(none)"}</span>
        <span data-testid="screen-id">{nav.route?.screenId ?? "(none)"}</span>
        <span data-testid="href-dispatch">
          {nav.hrefFor({ workspaceId: "dispatch", screenId: "task-list" })}
        </span>
        <button
          type="button"
          data-testid="go-dispatch"
          onClick={() => nav.navigate({ workspaceId: "dispatch", screenId: "task-list" })}
        >
          go
        </button>
      </div>
    );
  }

  test("Read: '/admin/dispatch/task-list' → workspaceId='dispatch', screenId='task-list'", () => {
    window.history.replaceState(null, "", "/admin/dispatch/task-list");
    render(
      <WorkspaceAdminNav>
        <WorkspaceProbe />
      </WorkspaceAdminNav>,
    );
    expect(screen.getByTestId("workspace-id").textContent).toBe("dispatch");
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
  });

  test("Write: hrefFor with Workspace target prepends basePath BEFORE the Workspace id", () => {
    render(
      <WorkspaceAdminNav>
        <WorkspaceProbe />
      </WorkspaceAdminNav>,
    );
    expect(screen.getByTestId("href-dispatch").textContent).toBe("/admin/dispatch/task-list");
  });

  test("Write: navigate with Workspace target lands on '/admin/dispatch/task-list'", () => {
    render(
      <WorkspaceAdminNav>
        <WorkspaceProbe />
      </WorkspaceAdminNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("go-dispatch"));
    });
    expect(window.location.pathname).toBe("/admin/dispatch/task-list");
    expect(screen.getByTestId("workspace-id").textContent).toBe("dispatch");
    expect(screen.getByTestId("screen-id").textContent).toBe("task-list");
  });
});
