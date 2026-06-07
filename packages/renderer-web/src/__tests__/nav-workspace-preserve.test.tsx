//
// useBrowserNavApi({ hasWorkspaces }) — NavTarget-Contract: workspaceId
// weglassen = aktueller Workspace bleibt. Regression zum Prod-Bug
// 2026-06-07 (publicstatus Bugs 3/5): navigate({ screenId }) aus einem
// Workspace heraus erzeugte `/<screenId>`, parsePath las das Screen-
// Segment als Workspace-Id, WorkspaceShell revertete sofort auf den
// Default-Screen — Edit-/Toolbar-Aktionen wirkten tot.
//

import { beforeEach, describe, expect, test } from "bun:test";
import { NavProvider, useNav } from "@cosmicdrift/kumiko-renderer";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useBrowserNavApi } from "../app/nav";

function WorkspaceNav({ children }: { readonly children: ReactNode }): ReactNode {
  const api = useBrowserNavApi({ hasWorkspaces: true });
  return <NavProvider value={api}>{children}</NavProvider>;
}

function Probe(): React.ReactElement {
  const nav = useNav();
  return (
    <div>
      <span data-testid="workspace-id">{nav.route?.workspaceId ?? "(none)"}</span>
      <span data-testid="screen-id">{nav.route?.screenId ?? "(none)"}</span>
      <span data-testid="entity-id">{nav.route?.entityId ?? "(none)"}</span>
      <span data-testid="href-edit">
        {nav.hrefFor({ screenId: "component-edit", entityId: "c1" })}
      </span>
      <button
        type="button"
        data-testid="go-edit"
        onClick={() => nav.navigate({ screenId: "component-edit", entityId: "c1" })}
      >
        edit
      </button>
      <button
        type="button"
        data-testid="go-form"
        onClick={() => nav.navigate({ screenId: "maintenance-schedule-form" })}
      >
        form
      </button>
      <button
        type="button"
        data-testid="go-other-workspace"
        onClick={() => nav.navigate({ workspaceId: "visual", screenId: "tree" })}
      >
        switch
      </button>
      <button
        type="button"
        data-testid="replace-form"
        onClick={() => nav.replace({ screenId: "maintenance-schedule-form" })}
      >
        replace
      </button>
    </div>
  );
}

describe("useBrowserNavApi({ hasWorkspaces: true }) — Workspace-Erhalt ohne explizite workspaceId", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/admin/component-list");
  });

  test("navigate({ screenId, entityId }) erbt den aktuellen Workspace → '/admin/component-edit/c1'", () => {
    render(
      <WorkspaceNav>
        <Probe />
      </WorkspaceNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("go-edit"));
    });
    expect(window.location.pathname).toBe("/admin/component-edit/c1");
    expect(screen.getByTestId("workspace-id").textContent).toBe("admin");
    expect(screen.getByTestId("screen-id").textContent).toBe("component-edit");
    expect(screen.getByTestId("entity-id").textContent).toBe("c1");
  });

  test("navigate({ screenId }) (Toolbar-Fall 'Wartung planen') bleibt im Workspace", () => {
    render(
      <WorkspaceNav>
        <Probe />
      </WorkspaceNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("go-form"));
    });
    expect(window.location.pathname).toBe("/admin/maintenance-schedule-form");
    expect(screen.getByTestId("screen-id").textContent).toBe("maintenance-schedule-form");
  });

  test("explizite workspaceId gewinnt weiterhin (WorkspaceSwitcher-Fall)", () => {
    render(
      <WorkspaceNav>
        <Probe />
      </WorkspaceNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("go-other-workspace"));
    });
    expect(window.location.pathname).toBe("/visual/tree");
    expect(screen.getByTestId("workspace-id").textContent).toBe("visual");
  });

  test("replace erbt den Workspace symmetrisch zu navigate", () => {
    render(
      <WorkspaceNav>
        <Probe />
      </WorkspaceNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("replace-form"));
    });
    expect(window.location.pathname).toBe("/admin/maintenance-schedule-form");
  });

  test("hrefFor erbt den Workspace — Anchor-Links zeigen nicht aus dem Workspace raus", () => {
    render(
      <WorkspaceNav>
        <Probe />
      </WorkspaceNav>,
    );
    expect(screen.getByTestId("href-edit").textContent).toBe("/admin/component-edit/c1");
  });

  test("ohne aktuelle Route (URL an der Root) bleibt das Target unverändert", () => {
    window.history.replaceState(null, "", "/");
    render(
      <WorkspaceNav>
        <Probe />
      </WorkspaceNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("go-form"));
    });
    // Kein Workspace zum Erben — formatPath bleibt flach; WorkspaceShell
    // löst die Default-Workspace-Auflösung wie bisher selbst.
    expect(window.location.pathname).toBe("/maintenance-schedule-form");
  });
});

describe("useBrowserNavApi ohne Workspaces — Injection bleibt aus", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/task-list");
  });

  function FlatNav({ children }: { readonly children: ReactNode }): ReactNode {
    const api = useBrowserNavApi({ hasWorkspaces: false });
    return <NavProvider value={api}>{children}</NavProvider>;
  }

  test("navigate({ screenId }) bleibt flach: '/maintenance-schedule-form'", () => {
    render(
      <FlatNav>
        <Probe />
      </FlatNav>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("go-form"));
    });
    expect(window.location.pathname).toBe("/maintenance-schedule-form");
  });
});
