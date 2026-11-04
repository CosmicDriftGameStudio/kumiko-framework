import { describe, expect, test } from "bun:test";
import type { RowAction } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { NavApi } from "../nav.tsx";
import { buildRecordActions } from "../row-actions.ts";

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

// build only reads the dispatcher inside onPress, so an empty stand-in keeps the writeHandler action alive.
const idleDispatcher = {} as Dispatcher;

const ACTIONS: readonly RowAction[] = [
  { kind: "navigate", id: "to-screen", label: "l", screen: "detail", display: "link" },
  { kind: "navigate", id: "to-entity", label: "l", entity: "order", display: "link" },
  { kind: "drawer", id: "drawer", label: "l", screen: "form", display: "link" },
  { id: "write", label: "l", handler: "x:write:y:z", display: "link" },
  { kind: "clientAction", id: "client", label: "l", action: "noop", display: "link" },
];

describe("buildRecordActions display", () => {
  test("every action kind carries its display onto the RenderEditAction", () => {
    const built = buildRecordActions({
      actions: ACTIONS,
      record: { id: "o1" },
      translate: (key) => key,
      nav,
      host: undefined,
      dispatcher: idleDispatcher,
      openDrawer: () => {},
      onWriteSuccess: async () => {},
    });
    expect(built?.map((action) => [action.id, action.display])).toEqual(
      ACTIONS.map((action) => [action.id, "link"]),
    );
  });

  test("an action without display leaves it unset", () => {
    const built = buildRecordActions({
      actions: [{ kind: "navigate", id: "plain", label: "l", screen: "detail" }],
      record: { id: "o1" },
      translate: (key) => key,
      nav,
      host: undefined,
      dispatcher: undefined,
      openDrawer: () => {},
      onWriteSuccess: async () => {},
    });
    expect(built?.[0]).not.toHaveProperty("display");
  });
});
