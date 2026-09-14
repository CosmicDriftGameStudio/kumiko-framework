// Exercises the real navigation stack end to end (real useBrowserNavApi),
// asserting on window.location instead of a captured NavTarget.
import { afterEach, describe, expect, test } from "bun:test";
import type {
  DashboardScreenDefinition,
  EntityDefinition,
  FeatureSchema,
  ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import {
  AppFeaturesProvider,
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  NavProvider,
  qualifyScreenId,
  UserRolesProvider,
  useNav,
} from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { WebDashboardBody } from "../app/dashboard-body";
import { useBrowserNavApi } from "../app/nav";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils";

const tokenEntity: EntityDefinition = {
  fields: { name: { type: "text", required: false, searchable: false, sortable: false } },
};

const dashboardScreen: DashboardScreenDefinition = {
  id: "settings",
  type: "dashboard",
  panels: [
    { kind: "screen", id: "list", screen: "token-list" },
    { kind: "screen", id: "stats", screen: "token-stats" },
  ],
};

const listScreen: ScreenDefinition = {
  id: "token-list",
  type: "entityList",
  entity: "token",
  columns: ["name"],
  toolbarActions: [
    { kind: "navigate", id: "create", label: "create", screen: "token-create" },
    { kind: "navigate", id: "action", label: "action", screen: "token-action" },
  ],
  rowActions: [{ kind: "navigate", id: "open", label: "open", screen: "token-open" }],
};

const secretMintScreen: ScreenDefinition = {
  id: "token-create",
  type: "secretMint",
  handler: "tokens:write:token-secret:mint",
  fields: { label: { type: "text", required: false, searchable: false, sortable: false } },
  layout: { sections: [{ fields: ["label"] }] },
  reveal: { fields: [{ field: "secret", label: "secret" }] },
  redirect: "token-list",
  cancelTarget: "token-list",
};

const tokenActionScreen: ScreenDefinition = {
  id: "token-action",
  type: "actionForm",
  handler: "tokens:write:token:action",
  fields: {},
  layout: { sections: [] },
  redirect: "token-list",
};

const tokenOpenScreen: ScreenDefinition = {
  id: "token-open",
  type: "actionForm",
  handler: "tokens:write:token:open",
  fields: {},
  layout: { sections: [] },
  redirect: { screen: "token-edit", idFrom: "id" },
};

const tokenEditScreen: ScreenDefinition = {
  id: "token-edit",
  type: "entityEdit",
  entity: "token",
  layout: { sections: [{ fields: ["name"] }] },
};

// A second, distinct record screen for the same entity/id — lets returnTo
// name a record screen that is NOT the one being deleted (delete-guard test).
// Also carries a relatedList section for the host-threading test (18/19
// cover entityList/projectionList; this one covers relatedList).
const tokenDetailScreen: ScreenDefinition = {
  id: "token-detail",
  type: "projectionDetail",
  query: "tokens:query:token:detail-view",
  layout: {
    sections: [
      { fields: ["name"] },
      {
        kind: "relatedList",
        title: "Related",
        query: "tokens:query:token:related",
        columns: ["name"],
        toolbarActions: [
          {
            kind: "navigate",
            id: "related-action",
            label: "related-action",
            screen: "token-action",
          },
        ],
      },
    ],
  },
};

const tokenStatsScreen: ScreenDefinition = {
  id: "token-stats",
  type: "projectionList",
  query: "tokens:query:token:stats",
  columns: [{ field: "name", label: "name" }],
  toolbarActions: [
    { kind: "navigate", id: "stats-action", label: "stats-action", screen: "token-action" },
  ],
  rowActions: [
    { kind: "navigate", id: "stats-row-action", label: "stats-row-action", screen: "token-action" },
  ],
};

const adminOnlyScreen: ScreenDefinition = {
  id: "admin-only",
  type: "custom",
  renderer: { react: "stub" },
  access: { roles: ["Admin"] },
};

const schema: FeatureSchema = {
  featureName: "tokens",
  entities: { token: tokenEntity },
  screens: [
    dashboardScreen,
    listScreen,
    secretMintScreen,
    tokenActionScreen,
    tokenOpenScreen,
    tokenEditScreen,
    tokenDetailScreen,
    tokenStatsScreen,
    adminOnlyScreen,
  ],
};

function makeDispatcher(): Dispatcher {
  return createMockDispatcher({
    query: (async (type: string) => {
      if (type === "tokens:query:token:list") {
        return {
          isSuccess: true,
          data: { rows: [{ id: "tok-1", name: "Token 1" }], nextCursor: null, total: 1 },
        };
      }
      // Distinct row data from the entityList above — both panels render on
      // the same dashboard, and duplicate text/ids would break `getByText`/
      // `getByTestId` uniqueness in the other tests.
      if (type === "tokens:query:token:stats") {
        return {
          isSuccess: true,
          data: { rows: [{ id: "stat-1", name: "Stat A" }], nextCursor: null, total: 1 },
        };
      }
      if (type === "tokens:query:token:detail") {
        return { isSuccess: true, data: { id: "tok-1", version: 1, name: "Token 1" } };
      }
      if (type === "tokens:query:token:related") {
        return {
          isSuccess: true,
          data: { rows: [{ id: "rel-1", name: "Related A" }], nextCursor: null },
        };
      }
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["query"],
    write: (async (command: string) => {
      if (command === "tokens:write:token-secret:mint") {
        return { isSuccess: true, data: { secret: "shh-secret" } };
      }
      if (command === "tokens:write:token:open") {
        return { isSuccess: true, data: { id: "tok-1" } };
      }
      if (command === "tokens:write:token:create") {
        return { isSuccess: true, data: { id: "new-tok" } };
      }
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
  });
}

function RouterScreen({ appSchema }: { readonly appSchema: FeatureSchema }): ReactNode {
  const nav = useNav();
  if (nav.route === undefined) return null;
  const qn = qualifyScreenId(appSchema.featureName, nav.route.screenId);
  return (
    <KumikoScreen
      schema={appSchema}
      qn={qn}
      {...(nav.route.entityId !== undefined && { entityId: nav.route.entityId })}
    />
  );
}

function BrowserNavRoot({ appSchema }: { readonly appSchema: FeatureSchema }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return (
    <NavProvider value={nav}>
      <RouterScreen appSchema={appSchema} />
    </NavProvider>
  );
}

function App({
  appSchema,
  dispatcher,
}: {
  readonly appSchema: FeatureSchema;
  readonly dispatcher: Dispatcher;
}): ReactNode {
  return (
    <DispatcherProvider dispatcher={dispatcher}>
      <AppFeaturesProvider features={[appSchema]}>
        <UserRolesProvider roles={["User"]}>
          <DashboardBodyProvider value={WebDashboardBody}>
            <BrowserNavRoot appSchema={appSchema} />
          </DashboardBodyProvider>
        </UserRolesProvider>
      </AppFeaturesProvider>
    </DispatcherProvider>
  );
}

function renderApp(): void {
  render(<App appSchema={schema} dispatcher={makeDispatcher()} />);
}

async function waitForEnabled(testId: string): Promise<HTMLButtonElement> {
  const btn = screen.getByTestId(testId) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  return btn;
}

describe("returnTo", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("1. embedded list toolbar create sets returnTo=settings; cancel returns to settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings");
    renderApp();

    await waitFor(() => expect(screen.getByText("Token 1")).toBeTruthy());
    await user.click(screen.getByTestId("render-list-toolbar-action-create"));

    expect(window.location.pathname).toBe("/token-create");
    expect(window.location.search).toBe("?returnTo=settings");

    await user.click(screen.getByTestId("render-edit-cancel"));
    expect(window.location.pathname).toBe("/settings");
  });

  test("2. embedded list toolbar create → fill + submit reveals the secret → confirm returns to settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings");
    renderApp();

    await waitFor(() => expect(screen.getByText("Token 1")).toBeTruthy());
    await user.click(screen.getByTestId("render-list-toolbar-action-create"));
    expect(window.location.pathname).toBe("/token-create");

    const input = screen.getByTestId("field-label").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My token" } });
    const submitBtn = await waitForEnabled("render-edit-submit");
    await user.click(submitBtn);

    await waitFor(() =>
      expect(screen.getByTestId("kumiko-screen-secret-mint-reveal")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("kumiko-screen-secret-mint-confirm"));

    expect(window.location.pathname).toBe("/settings");
  });

  test("3. embedded list toolbar action → submit returns to settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings");
    renderApp();

    await waitFor(() => expect(screen.getByText("Token 1")).toBeTruthy());
    await user.click(screen.getByTestId("render-list-toolbar-action-action"));
    expect(window.location.pathname).toBe("/token-action");
    expect(window.location.search).toBe("?returnTo=settings");

    const submitBtn = await waitForEnabled("render-edit-submit");
    await user.click(submitBtn);

    await waitFor(() => expect(window.location.pathname).toBe("/settings"));
  });

  test("3b. embedded list toolbar action → cancel returns to settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings");
    renderApp();

    await waitFor(() => expect(screen.getByText("Token 1")).toBeTruthy());
    await user.click(screen.getByTestId("render-list-toolbar-action-action"));
    expect(window.location.pathname).toBe("/token-action");

    await user.click(screen.getByTestId("render-edit-cancel"));
    expect(window.location.pathname).toBe("/settings");
  });

  test("4. + New (default create) on embedded list → token-edit create → save returns to settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings");
    renderApp();

    await waitFor(() => expect(screen.getByText("Token 1")).toBeTruthy());
    await user.click(screen.getByTestId("render-list-create"));

    expect(window.location.pathname).toBe("/token-edit");
    expect(window.location.search).toBe("?returnTo=settings");

    const input = screen.getByTestId("field-name").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New Token" } });
    const submitBtn = await waitForEnabled("render-edit-submit");
    await user.click(submitBtn);

    await waitFor(() => expect(window.location.pathname).toBe("/settings"));
  });

  test("5. row action with a record-targeting redirect lands on token-edit/<id>, not settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings");
    renderApp();

    await waitFor(() => expect(screen.getByText("Token 1")).toBeTruthy());
    await user.click(screen.getByTestId("row-tok-1-action-open"));

    expect(window.location.pathname).toBe("/token-open");
    expect(window.location.search).toBe("?returnTo=settings");

    const submitBtn = await waitForEnabled("render-edit-submit");
    await user.click(submitBtn);

    await waitFor(() => expect(window.location.pathname).toBe("/token-edit/tok-1"));
  });

  test("6. direct navigation to token-create (no returnTo) → cancel falls back to cancelTarget", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-create");
    renderApp();

    const cancelBtn = await screen.findByTestId("render-edit-cancel");
    await user.click(cancelBtn);
    expect(window.location.pathname).toBe("/token-list");
  });

  test.each([
    "unknown-screen",
    "//evil.com",
    "https://evil.com",
    "tokens:screen:settings",
    "admin-only",
    "token-create",
    "settings/x/y",
  ])("7. manipulated returnTo=%s falls back to cancelTarget", async (value) => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/token-create?returnTo=${encodeURIComponent(value)}`);
    renderApp();

    const cancelBtn = await screen.findByTestId("render-edit-cancel");
    await user.click(cancelBtn);
    expect(window.location.pathname).toBe("/token-list");
  });

  test("8. non-embedded token-list toolbar create sets returnTo=token-list, cancel returns there", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-list");
    renderApp();

    await waitFor(() => expect(screen.getByText("Token 1")).toBeTruthy());
    await user.click(screen.getByTestId("render-list-toolbar-action-create"));

    expect(window.location.pathname).toBe("/token-create");
    expect(window.location.search).toBe("?returnTo=token-list");

    await user.click(screen.getByTestId("render-edit-cancel"));
    expect(window.location.pathname).toBe("/token-list");
  });

  test("9. direct navigation to token-action (no returnTo) → submit falls back to its own redirect", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-action");
    renderApp();

    const submitBtn = await waitForEnabled("render-edit-submit");
    await user.click(submitBtn);

    await waitFor(() => expect(window.location.pathname).toBe("/token-list"));
  });

  test("10. direct navigation to token-action (no returnTo) → cancel falls back to its own redirect", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-action");
    renderApp();

    const cancelBtn = await screen.findByTestId("render-edit-cancel");
    await user.click(cancelBtn);
    expect(window.location.pathname).toBe("/token-list");
  });

  test("11. direct navigation to token-create (no returnTo) → submit → reveal → confirm falls back to redirect", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-create");
    renderApp();

    const input = await screen.findByTestId("field-label");
    fireEvent.change(input.querySelector("input") as HTMLInputElement, {
      target: { value: "My token" },
    });
    const submitBtn = await waitForEnabled("render-edit-submit");
    await user.click(submitBtn);

    await waitFor(() =>
      expect(screen.getByTestId("kumiko-screen-secret-mint-reveal")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("kumiko-screen-secret-mint-confirm"));

    expect(window.location.pathname).toBe("/token-list");
  });

  test("12. direct navigation to token-edit create (no returnTo) → save falls back to the entity's list", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-edit");
    renderApp();

    const input = await screen.findByTestId("field-name");
    fireEvent.change(input.querySelector("input") as HTMLInputElement, {
      target: { value: "New Token" },
    });
    const submitBtn = await waitForEnabled("render-edit-submit");
    await user.click(submitBtn);

    await waitFor(() => expect(window.location.pathname).toBe("/token-list"));
  });

  test("13. entityEdit update with returnTo=settings → save returns to settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-edit/tok-1?returnTo=settings");
    renderApp();

    const input = await screen.findByTestId("field-name");
    await waitFor(() =>
      expect((input.querySelector("input") as HTMLInputElement).value).toBe("Token 1"),
    );
    fireEvent.change(input.querySelector("input") as HTMLInputElement, {
      target: { value: "Renamed" },
    });
    const submitBtn = await waitForEnabled("render-edit-submit");
    await user.click(submitBtn);

    await waitFor(() => expect(window.location.pathname).toBe("/settings"));
  });

  test("14. entityEdit update with returnTo=settings → cancel returns to settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-edit/tok-1?returnTo=settings");
    renderApp();

    const cancelBtn = await screen.findByTestId("render-edit-cancel");
    await user.click(cancelBtn);
    expect(window.location.pathname).toBe("/settings");
  });

  test("15. entityEdit update with returnTo=settings → delete returns to settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-edit/tok-1?returnTo=settings");
    renderApp();

    await screen.findByTestId("field-name");
    await user.click(screen.getByTestId("render-edit-delete"));
    await user.click(screen.getByTestId("render-edit-delete-dialog-confirm"));

    await waitFor(() => expect(window.location.pathname).toBe("/settings"));
  });

  test("16. delete-guard: returnTo pointing at the just-deleted record falls back to the list", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-edit/tok-1?returnTo=token-detail/tok-1");
    renderApp();

    await screen.findByTestId("field-name");
    await user.click(screen.getByTestId("render-edit-delete"));
    await user.click(screen.getByTestId("render-edit-delete-dialog-confirm"));

    await waitFor(() => expect(window.location.pathname).toBe("/token-list"));
  });

  test("17. manipulated entityId in the real URL (returnTo=token-edit/%2e%2e) → cancel falls back to cancelTarget", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-create?returnTo=token-edit/%2e%2e");
    renderApp();

    const cancelBtn = await screen.findByTestId("render-edit-cancel");
    await user.click(cancelBtn);
    expect(window.location.pathname).toBe("/token-list");
  });

  test("18. projectionList embedded in the dashboard: toolbar navigate carries returnTo=settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings");
    renderApp();

    await user.click(await screen.findByTestId("render-list-toolbar-action-stats-action"));

    expect(window.location.pathname).toBe("/token-action");
    expect(window.location.search).toBe("?returnTo=settings");
  });

  test("19. projectionList embedded in the dashboard: row action navigate carries returnTo=settings", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings");
    renderApp();

    await user.click(await screen.findByTestId("row-stat-1-action-stats-row-action"));

    expect(window.location.pathname).toBe("/token-action");
    expect(window.location.search).toBe("?returnTo=settings");
  });

  test("20. relatedList toolbar navigate (in a projectionDetail) sets returnTo=<detail>/<id> and its parentParam prefill", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/token-detail/tok-1");
    renderApp();

    await user.click(await screen.findByTestId("render-list-toolbar-action-related-action"));

    expect(window.location.pathname).toBe("/token-action");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("returnTo")).toBe("token-detail/tok-1");
    expect(params.get("id")).toBe("tok-1");
  });
});
