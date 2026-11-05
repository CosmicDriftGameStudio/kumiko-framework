import { describe, expect, test } from "bun:test";
import type { RelatedListToolbarAction } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { NavApi } from "../nav.tsx";
import { buildProjectionToolbarActions } from "../row-actions.ts";

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

// Only built, never triggered: the stub just has to exist so writeHandler actions are not skipped.
const noopDispatcher = {
  write: async () => ({ isSuccess: true, data: {} }),
} as unknown as Dispatcher;

function iconOf(action: RelatedListToolbarAction): string | undefined {
  const buttons = buildProjectionToolbarActions({
    toolbarActions: [action],
    translate: (key) => key,
    dispatcher: noopDispatcher,
    nav,
    refetch: async () => {},
    host: undefined,
    openDrawer: () => {},
    record: {},
  });
  return buttons?.[0]?.icon;
}

describe("toolbar action icon", () => {
  test("a declared icon wins for navigate, drawer and writeHandler, even when the id derives none", () => {
    expect(iconOf({ kind: "navigate", id: "notify", label: "l", screen: "s", icon: "plus" })).toBe(
      "plus",
    );
    expect(iconOf({ kind: "drawer", id: "notify", label: "l", screen: "s", icon: "lock" })).toBe(
      "lock",
    );
    expect(
      iconOf({
        kind: "writeHandler",
        id: "notify",
        label: "l",
        handler: "a:write:b",
        icon: "lock",
      }),
    ).toBe("lock");
  });

  test("without a declared icon the id-derived default applies", () => {
    expect(iconOf({ kind: "navigate", id: "create", label: "l", screen: "s" })).toBe("plus");
    expect(iconOf({ kind: "navigate", id: "notify", label: "l", screen: "s" })).toBeUndefined();
    expect(iconOf({ kind: "writeHandler", id: "create", label: "l", handler: "a:write:b" })).toBe(
      "plus",
    );
    expect(
      iconOf({ kind: "writeHandler", id: "notify", label: "l", handler: "a:write:b" }),
    ).toBeUndefined();
  });
});
