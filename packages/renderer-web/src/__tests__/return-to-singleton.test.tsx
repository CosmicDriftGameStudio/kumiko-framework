// Split out of return-to.test.tsx: the singleton create->update path fires
// fireEvent.change immediately followed by a click right after an async load
// settles — the #457 shared single-process happy-dom pattern. Isolated the
// same way as kumiko-screen-singleton-entity-edit.test.tsx (bunfig.ci-dom.toml,
// pathIgnorePatterns in bunfig.dom.toml).
import { describe, expect, mock, test } from "bun:test";
import type {
  DashboardScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  FeatureSchema,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import {
  AppFeaturesProvider,
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  NavProvider,
  qualifyScreenId,
  useNav,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { WebDashboardBody } from "../app/dashboard-body";
import { useBrowserNavApi } from "../app/nav";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils";

const settingEntity: EntityDefinition = {
  fields: { title: { type: "text", required: false, searchable: false, sortable: false } },
};

const singletonScreen: EntityEditScreenDefinition = {
  id: "settings-edit",
  type: "entityEdit",
  entity: "setting",
  singleton: true,
  layout: { sections: [{ fields: ["title"] }] },
};

const dashboardScreen: DashboardScreenDefinition = {
  id: "home",
  type: "dashboard",
  panels: [{ kind: "screen", id: "singleton", screen: "settings-edit" }],
};

const schema: FeatureSchema = {
  featureName: "settingsfeat",
  entities: { setting: settingEntity },
  screens: [dashboardScreen, singletonScreen],
};

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
        <DashboardBodyProvider value={WebDashboardBody}>
          <BrowserNavRoot appSchema={appSchema} />
        </DashboardBodyProvider>
      </AppFeaturesProvider>
    </DispatcherProvider>
  );
}

describe("returnTo — singleton entityEdit ignores it", () => {
  test("reached with ?returnTo=home, saving stays on the singleton screen", async () => {
    let created = false;
    const write = mock(async (type: string) => {
      if (type === "settingsfeat:write:setting:create") {
        created = true;
        return { isSuccess: true, data: { id: "s1" } };
      }
      return { isSuccess: true, data: {} };
    });
    const query = mock(async (type: string) => {
      if (type === "settingsfeat:query:setting:list") {
        return created
          ? { isSuccess: true, data: { rows: [{ id: "s1", title: "Saved title" }] } }
          : { isSuccess: true, data: { rows: [], nextCursor: null } };
      }
      if (type === "settingsfeat:query:setting:detail") {
        return {
          isSuccess: true,
          data: { id: "s1", version: 1, title: "Saved title" },
        };
      }
      return { isSuccess: true, data: { rows: [], nextCursor: null } };
    });
    const dispatcher = createMockDispatcher({
      write: write as unknown as Dispatcher["write"],
      query: query as unknown as Dispatcher["query"],
    });

    window.history.replaceState(null, "", "/settings-edit?returnTo=home");
    render(<App appSchema={schema} dispatcher={dispatcher} />);

    await waitFor(() => expect(screen.getByTestId("field-title")).toBeTruthy());
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Saved title" } });
    await waitFor(() => {
      const button = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    // The singleton wrapper flips to the update form of the newly created
    // record instead of navigating anywhere — returnTo must not interfere.
    await waitFor(() => {
      const input = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("Saved title");
    });
    expect(window.location.pathname).toBe("/settings-edit");

    window.history.replaceState(null, "", "/");
  });
});
