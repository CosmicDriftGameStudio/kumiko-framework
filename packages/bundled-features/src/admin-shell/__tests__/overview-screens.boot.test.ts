import { describe, expect, test } from "bun:test";
import { access } from "@cosmicdrift/kumiko-framework/engine";
import { ConfigQueries } from "../../config/constants";
import { JobQueries } from "../../jobs/constants";
import { TenantQueries } from "../../tenant/constants";
import { UserQueries } from "../../user/constants";
import { PLATFORM_OVERVIEW_SCREEN_ID, TENANT_OVERVIEW_SCREEN_ID } from "../constants";
import { createAdminShellFeature } from "../feature";

const adminShell = createAdminShellFeature();

function statPanelQueries(screenId: string): readonly string[] {
  const screen = adminShell.screens[screenId];
  if (screen?.type !== "dashboard") throw new Error(`expected dashboard screen: ${screenId}`);
  return screen.panels.map((panel) => {
    if (panel.kind !== "stat") throw new Error(`expected stat panel on ${screenId}: ${panel.kind}`);
    return panel.query;
  });
}

describe("overview screens boot", () => {
  test("tenant-overview screen is access.admin, dashboard with 3 stat panels", () => {
    const screen = adminShell.screens[TENANT_OVERVIEW_SCREEN_ID];
    expect(screen?.access).toEqual({ roles: access.admin });
    expect(screen?.type).toBe("dashboard");
    expect(statPanelQueries(TENANT_OVERVIEW_SCREEN_ID)).toEqual([
      TenantQueries.invitations,
      TenantQueries.members,
      ConfigQueries.readiness,
    ]);
  });

  test("platform-overview screen is SystemAdmin-only, dashboard with 3 stat panels", () => {
    const screen = adminShell.screens[PLATFORM_OVERVIEW_SCREEN_ID];
    expect(screen?.access).toEqual({ roles: access.systemAdmin });
    expect(screen?.type).toBe("dashboard");
    expect(statPanelQueries(PLATFORM_OVERVIEW_SCREEN_ID)).toEqual([
      TenantQueries.list,
      UserQueries.list,
      JobQueries.list,
    ]);
  });
});
