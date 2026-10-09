import { describe, expect, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { NavApi } from "../nav.js";
import { buildRecordActions } from "../row-actions.js";

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

const DISCARD = "unsaved will be lost";

function build(discardChangesConfirm: string | undefined) {
  return buildRecordActions({
    actions: [
      { kind: "writeHandler", id: "plain", label: "l.plain", handler: "app:write:x:archive" },
      {
        kind: "writeHandler",
        id: "own",
        label: "l.own",
        handler: "app:write:x:delete",
        confirm: "l.ownConfirm",
      },
      { kind: "drawer", id: "drawer", label: "l.drawer", screen: "form" },
      { kind: "navigate", id: "nav", label: "l.nav", screen: "other" },
    ],
    record: { id: "r1" },
    translate: (key) => (key === "l.ownConfirm" ? "Really?" : key),
    nav,
    host: undefined,
    dispatcher: {} as Dispatcher,
    openDrawer: () => {},
    onWriteSuccess: async () => {},
    ...(discardChangesConfirm !== undefined && { discardChangesConfirm }),
  });
}

function actionById(
  actions: ReturnType<typeof build>,
  id: string,
): NonNullable<ReturnType<typeof build>>[number] | undefined {
  return actions?.find((a) => a.id === id);
}

describe("buildRecordActions discardChangesConfirm", () => {
  test("writeHandler and drawer actions get the discard text as their confirm", () => {
    const actions = build(DISCARD);
    expect(actionById(actions, "plain")?.confirm).toBe(DISCARD);
    expect(actionById(actions, "drawer")?.confirm).toBe(DISCARD);
  });

  test("an own confirm text comes first, then a blank line, then the discard text", () => {
    expect(actionById(build(DISCARD), "own")?.confirm).toBe(`Really?\n\n${DISCARD}`);
  });

  test("navigate actions are unchanged", () => {
    expect(actionById(build(DISCARD), "nav")?.confirm).toBeUndefined();
  });

  test("without the option no confirm is added", () => {
    const actions = build(undefined);
    expect(actionById(actions, "plain")?.confirm).toBeUndefined();
    expect(actionById(actions, "drawer")?.confirm).toBeUndefined();
    expect(actionById(actions, "own")?.confirm).toBe("Really?");
  });
});
