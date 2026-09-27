import { describe, expect, test } from "bun:test";
import type {
  RelatedListToolbarAction,
  RowActionNavigate,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { NavApi, NavTarget } from "../nav";
import { RETURN_TO_PARAM, type ReturnHost } from "../return-to";
import {
  buildProjectionToolbarActions,
  buildRecordActions,
  runProjectionRowNavigate,
} from "../row-actions";

function recordingNav(hrefFor: (target: NavTarget) => string = () => ""): {
  readonly nav: NavApi;
  readonly navigateCalls: NavTarget[];
  readonly setSearchParamsCalls: ReadonlyArray<Readonly<Record<string, string | null>>>;
} {
  const navigateCalls: NavTarget[] = [];
  const setSearchParamsCalls: Array<Readonly<Record<string, string | null>>> = [];
  const nav: NavApi = {
    route: undefined,
    navigate: (target) => navigateCalls.push(target),
    replace: () => {},
    hrefFor,
    searchParams: {},
    setSearchParams: (updates) => setSearchParamsCalls.push(updates),
  };
  return { nav, navigateCalls, setSearchParamsCalls };
}

// hrefFor maps entity ObjectTargets to their detail screen, mirroring resolveTarget.
const hrefForVehicleDetail = (target: NavTarget): string =>
  "screenId" in target
    ? `/${[target.screenId, target.entityId].filter((s) => s !== undefined).join("/")}`
    : `/vehicle-detail/${target.id}`;

const host: ReturnHost = { screenId: "vehicle-list" };
const noOpenDrawer = (): void => {};
const noOnWriteSuccess = async (): Promise<void> => {};

describe("buildRecordActions — RowActionNavigate.tab", () => {
  test("screen-target: tab lands in the same setSearchParams call as returnTo", () => {
    const { nav, navigateCalls, setSearchParamsCalls } = recordingNav();
    const action: RowActionNavigate = {
      kind: "navigate",
      id: "view-channels",
      label: "app.actions.viewChannels",
      screen: "vehicle-detail",
      entityId: "id",
      tab: "channels",
      params: { pick: ["name"] },
    };
    const actions = buildRecordActions({
      actions: [action],
      record: { id: "abc", name: "Vehicle A" },
      translate: (key) => key,
      nav,
      host,
      dispatcher: undefined,
      openDrawer: noOpenDrawer,
      onWriteSuccess: noOnWriteSuccess,
    });
    actions?.[0]?.onPress();

    expect(navigateCalls).toEqual([{ screenId: "vehicle-detail", entityId: "abc" }]);
    expect(setSearchParamsCalls).toHaveLength(1);
    expect(setSearchParamsCalls[0]).toMatchObject({
      tab: "channels",
      name: "Vehicle A",
      [RETURN_TO_PARAM]: "vehicle-list",
    });
  });

  test("entity-target: tab is included in the navigate search params", () => {
    const { nav, setSearchParamsCalls } = recordingNav();
    const action: RowActionNavigate = {
      kind: "navigate",
      id: "view-channels",
      label: "app.actions.viewChannels",
      entity: "vehicle",
      entityId: "id",
      tab: "channels",
    };
    const actions = buildRecordActions({
      actions: [action],
      record: { id: "abc" },
      translate: (key) => key,
      nav,
      host: undefined,
      dispatcher: undefined,
      openDrawer: noOpenDrawer,
      onWriteSuccess: noOnWriteSuccess,
    });
    actions?.[0]?.onPress();

    expect(setSearchParamsCalls).toHaveLength(1);
    expect(setSearchParamsCalls[0]).toEqual({ tab: "channels" });
  });

  test("entity-target: carries returnTo when the target resolves away from the host", () => {
    const { nav, navigateCalls, setSearchParamsCalls } = recordingNav(hrefForVehicleDetail);
    const action: RowActionNavigate = {
      kind: "navigate",
      id: "view-channels",
      label: "app.actions.viewChannels",
      entity: "vehicle",
      entityId: "id",
      tab: "channels",
    };
    const actions = buildRecordActions({
      actions: [action],
      record: { id: "abc" },
      translate: (key) => key,
      nav,
      host,
      dispatcher: undefined,
      openDrawer: noOpenDrawer,
      onWriteSuccess: noOnWriteSuccess,
    });
    actions?.[0]?.onPress();

    expect(navigateCalls).toEqual([{ entity: "vehicle", id: "abc" }]);
    expect(setSearchParamsCalls).toEqual([{ tab: "channels", [RETURN_TO_PARAM]: "vehicle-list" }]);
  });

  test("no tab set: search params carry no tab key", () => {
    const { nav, setSearchParamsCalls } = recordingNav();
    const action: RowActionNavigate = {
      kind: "navigate",
      id: "view-channels",
      label: "app.actions.viewChannels",
      screen: "vehicle-detail",
      entityId: "id",
      params: { pick: ["name"] },
    };
    const actions = buildRecordActions({
      actions: [action],
      record: { id: "abc", name: "Vehicle A" },
      translate: (key) => key,
      nav,
      host,
      dispatcher: undefined,
      openDrawer: noOpenDrawer,
      onWriteSuccess: noOnWriteSuccess,
    });
    actions?.[0]?.onPress();

    expect(setSearchParamsCalls).toHaveLength(1);
    expect(setSearchParamsCalls[0]).not.toHaveProperty("tab");
  });
});

describe("buildProjectionToolbarActions — navigate.tab", () => {
  test("tab lands in the setSearchParams call", () => {
    const { nav, navigateCalls, setSearchParamsCalls } = recordingNav();
    const action: RelatedListToolbarAction = {
      kind: "navigate",
      id: "view-channels",
      label: "app.actions.viewChannels",
      screen: "vehicle-detail",
      tab: "channels",
    };
    const actions = buildProjectionToolbarActions({
      toolbarActions: [action],
      translate: (key) => key,
      dispatcher: undefined,
      nav,
      refetch: async () => {},
      host: undefined,
    });
    actions?.[0]?.onTrigger();

    expect(navigateCalls).toEqual([{ screenId: "vehicle-detail" }]);
    expect(setSearchParamsCalls).toEqual([{ tab: "channels" }]);
  });

  test("navigatePrefill and tab both survive into the same setSearchParams call, plus returnTo with a host", () => {
    const { nav, setSearchParamsCalls } = recordingNav();
    const action: RelatedListToolbarAction = {
      kind: "navigate",
      id: "create-channel",
      label: "app.actions.createChannel",
      screen: "channel-create",
      tab: "channels",
    };
    const actions = buildProjectionToolbarActions({
      toolbarActions: [action],
      translate: (key) => key,
      dispatcher: undefined,
      nav,
      refetch: async () => {},
      navigatePrefill: { vehicleId: "abc" },
      host,
    });
    actions?.[0]?.onTrigger();

    expect(setSearchParamsCalls).toHaveLength(1);
    expect(setSearchParamsCalls[0]).toMatchObject({
      tab: "channels",
      vehicleId: "abc",
      [RETURN_TO_PARAM]: "vehicle-list",
    });
  });
});

describe("runProjectionRowNavigate — entity target carries returnTo", () => {
  test("entity action with a host and tab: navigate gets the ObjectTarget, returnTo and tab land together", () => {
    const { nav, navigateCalls, setSearchParamsCalls } = recordingNav(hrefForVehicleDetail);
    const action: RowActionNavigate = {
      kind: "navigate",
      id: "view-channels",
      label: "app.actions.viewChannels",
      entity: "vehicle",
      entityId: "id",
      tab: "channels",
    };
    runProjectionRowNavigate(nav, action, { id: "abc", values: { id: "abc" } }, host);

    expect(navigateCalls).toEqual([{ entity: "vehicle", id: "abc" }]);
    expect(setSearchParamsCalls).toEqual([{ tab: "channels", [RETURN_TO_PARAM]: "vehicle-list" }]);
  });
});
