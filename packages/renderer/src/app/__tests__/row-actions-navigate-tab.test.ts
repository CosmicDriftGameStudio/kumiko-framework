import { describe, expect, test } from "bun:test";
import type { RowActionNavigate } from "@cosmicdrift/kumiko-framework/ui-types";
import type { NavApi, NavTarget } from "../nav";
import { RETURN_TO_PARAM, type ReturnHost } from "../return-to";
import { buildRecordActions } from "../row-actions";

function recordingNav(): {
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
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: (updates) => setSearchParamsCalls.push(updates),
  };
  return { nav, navigateCalls, setSearchParamsCalls };
}

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
      host,
      dispatcher: undefined,
      openDrawer: noOpenDrawer,
      onWriteSuccess: noOnWriteSuccess,
    });
    actions?.[0]?.onPress();

    expect(setSearchParamsCalls).toHaveLength(1);
    expect(setSearchParamsCalls[0]).toEqual({ tab: "channels" });
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
