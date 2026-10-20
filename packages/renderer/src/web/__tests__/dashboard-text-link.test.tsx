// A text-panel link block shows only to users holding one of its roles; the
// target screen's own access rule stays the enforcement.

import { describe, expect, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { FeatureSchema } from "../../index.ts";
import {
  createStaticLocaleResolver,
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
  UserRolesProvider,
} from "../../index.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { createMockDispatcher, render, screen } from "./test-utils.tsx";

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

const dashboard: DashboardScreenDefinition = {
  id: "overview",
  type: "dashboard",
  panels: [
    {
      kind: "text",
      id: "plan-hint",
      blocks: [
        { kind: "paragraph", text: "status:plan.limit-reached" },
        { kind: "link", text: "status:plan.show-plans", screen: "plans", roles: ["TenantAdmin"] },
        { kind: "link", text: "status:plan.help", screen: "help" },
      ],
    },
  ],
};

function renderOverview(roles: readonly string[] | undefined): void {
  const schema: FeatureSchema = { featureName: "status", entities: {}, screens: [dashboard] };
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[
        kumikoDefaultTranslations,
        {
          "de-DE": {
            "status:plan.limit-reached": "Sie haben Ihr Kontingent an Statusseiten erreicht.",
            "status:plan.show-plans": "Tarife ansehen",
            "status:plan.help": "Hilfe zum Tarif",
          },
        },
      ]}
    >
      <BrowserNav>
        <DispatcherProvider dispatcher={createMockDispatcher({})}>
          <UserRolesProvider roles={roles}>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn="status:screen:overview" />
            </DashboardBodyProvider>
          </UserRolesProvider>
        </DispatcherProvider>
      </BrowserNav>
    </LocaleProvider>,
  );
}

describe("dashboard text-panel link block", () => {
  test("shows the translated link to a user holding one of the roles", () => {
    renderOverview(["TenantAdmin"]);

    const link = screen.getByTestId("dashboard-text-link-plans");
    expect(link.textContent).toBe("Tarife ansehen");
    expect(link.getAttribute("href")).toContain("plans");
  });

  test("hides the role-gated link from a user without the role", () => {
    renderOverview(["TenantMember"]);

    expect(screen.queryByTestId("dashboard-text-link-plans")).toBeNull();
  });

  test("hides the role-gated link while the roles are unknown", () => {
    renderOverview(undefined);

    expect(screen.queryByTestId("dashboard-text-link-plans")).toBeNull();
  });

  test("a link without roles shows to everyone", () => {
    renderOverview(["TenantMember"]);

    expect(screen.getByTestId("dashboard-text-link-help").textContent).toBe("Hilfe zum Tarif");
  });
});
