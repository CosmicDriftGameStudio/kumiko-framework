import { describe, expect, test } from "bun:test";
import { access, MAX_LIST_LIMIT } from "@cosmicdrift/kumiko-framework/engine";
import { ConnectorHandlers, ConnectorQueries, ConnectorScreens } from "../constants.ts";
import { CONNECTORS_I18N } from "../i18n.ts";
import { connectorConfirmScreen, connectorListScreen, connectorPairScreen } from "../screens.ts";

describe("connector list screen", () => {
  test("renders the status through enumOption with a German and English text per status", () => {
    const statusColumn = connectorListScreen.columns.find(
      (column) => typeof column !== "string" && column.field === "status",
    );
    if (statusColumn === undefined || typeof statusColumn === "string") {
      throw new Error("status column missing");
    }
    const renderer = statusColumn.renderer;
    if (
      typeof renderer !== "object" ||
      !("format" in renderer) ||
      renderer.format !== "enumOption"
    ) {
      throw new Error("status column must use the enumOption format");
    }
    for (const status of ["active", "revoked"]) {
      const entry = CONNECTORS_I18N[`${renderer.keyPrefix}${status}`];
      expect(entry).toEqual({ en: expect.any(String), de: expect.any(String) });
    }
  });

  test("reads the list query in one max-size page without a pager", () => {
    expect(connectorListScreen.query).toBe(ConnectorQueries.list);
    expect(connectorListScreen.pagination).toBe(false);
    expect(connectorListScreen.pageSize).toBe(MAX_LIST_LIMIT);
  });

  test("offers revoke only for connectors that are not revoked, with a confirm text", () => {
    const [revoke] = connectorListScreen.rowActions ?? [];
    if (revoke?.kind !== "writeHandler") throw new Error("revoke row action missing");
    expect(revoke.handler).toBe(ConnectorHandlers.revoke);
    expect(revoke.style).toBe("danger");
    expect(revoke.visible).toEqual({ field: "status", ne: "revoked" });
    expect(revoke.confirm).toBe("connectors.list.revoke.confirm");
    expect(CONNECTORS_I18N[revoke.confirm ?? ""]?.de).toBe(
      "Diesen Anschluss sperren? Das Gerät kann sofort keine Dateien mehr liefern.",
    );
  });

  test("the empty state offers the same pairing action as the toolbar", () => {
    const [toolbarPair] = connectorListScreen.toolbarActions ?? [];
    const emptyAction = connectorListScreen.emptyState?.action;
    expect(toolbarPair?.kind).toBe("navigate");
    expect(emptyAction?.id).toBe(toolbarPair?.id);
  });

  test("every screen is for tenant admins only", () => {
    for (const screen of [connectorListScreen, connectorPairScreen, connectorConfirmScreen]) {
      expect(screen.access).toEqual({ roles: access.admin });
    }
  });
});

describe("connector pairing screens", () => {
  test("step one only checks the code and hands it to the confirm step through the URL", () => {
    expect(connectorPairScreen.handler).toBe(ConnectorHandlers.checkDevice);
    expect(connectorPairScreen.redirect).toEqual({
      screen: ConnectorScreens.confirm,
      searchParams: { userCode: "userCode" },
      handOff: true,
    });
    expect(Object.keys(connectorPairScreen.fields)).toEqual(["userCode"]);
  });

  test("step two confirms through approve-device and shows the request before the submit", () => {
    expect(connectorConfirmScreen.handler).toBe(ConnectorHandlers.approveDevice);
    expect(connectorConfirmScreen.preview?.query).toBe(ConnectorQueries.pendingRequest);
    expect(connectorConfirmScreen.preview?.fields).toEqual(["userCode"]);
    expect(connectorConfirmScreen.redirect).toBe(ConnectorScreens.list);
  });
});

describe("connector list columns", () => {
  test("a device never seen shows the never-seen label", () => {
    const column = connectorListScreen.columns.find(
      (c) => typeof c !== "string" && c.field === "lastSeenAt",
    );
    const renderer = typeof column === "string" ? undefined : column?.renderer;
    if (typeof renderer !== "object" || !("emptyLabel" in renderer)) {
      throw new Error("lastSeenAt needs an emptyLabel");
    }
    expect(CONNECTORS_I18N[renderer.emptyLabel as string]?.de).toBe("noch nie");
  });
});
