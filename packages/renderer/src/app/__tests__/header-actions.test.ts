import { describe, expect, test } from "bun:test";
import type { RenderEditAction } from "../../components/render-edit-types.ts";
import {
  compactHeaderPrimary,
  orderPlainHeaderActions,
  primaryHeaderAction,
} from "../header-actions.ts";

function action(id: string, extra: Partial<RenderEditAction> = {}): RenderEditAction {
  return { id, label: id, onPress: () => {}, ...extra };
}

const edit = action("edit", { icon: "pencil" });
const activate = action("activate", { icon: "check", style: "primary", confirm: "sure?" });
const archive = action("archive", { icon: "archive" });
const terminate = action("terminate", { icon: "x", style: "danger" });

describe("primaryHeaderAction", () => {
  test("without a preference edit wins over a style:primary action", () => {
    expect(primaryHeaderAction([activate, edit])?.id).toBe("edit");
  });

  test("the preferred id wins over edit", () => {
    expect(primaryHeaderAction([edit, activate], "activate")?.id).toBe("activate");
  });

  test("a preferred id that is not visible falls back to the default precedence", () => {
    expect(primaryHeaderAction([edit, activate], "ghost")?.id).toBe("edit");
  });

  test("without edit the first style:primary action wins, then the first action", () => {
    expect(primaryHeaderAction([archive, activate])?.id).toBe("activate");
    expect(primaryHeaderAction([archive, terminate])?.id).toBe("archive");
  });
});

describe("compactHeaderPrimary", () => {
  test("a declared confirm-gated action with an icon is icon-only", () => {
    const result = compactHeaderPrimary([edit, activate], "activate");
    expect(result?.action.id).toBe("activate");
    expect(result?.iconOnly).toBe(true);
  });

  test("a declared danger action with an icon is icon-only too", () => {
    expect(compactHeaderPrimary([edit, terminate], "terminate")).toEqual({
      action: terminate,
      iconOnly: true,
    });
  });

  test("a declared action without an icon stays a text button", () => {
    const sync = action("sync", { confirm: "sure?" });
    expect(compactHeaderPrimary([edit, sync], "sync")).toEqual({ action: sync, iconOnly: false });
  });

  test("a declared plain icon action is icon-only", () => {
    expect(compactHeaderPrimary([edit, archive], "archive")).toEqual({
      action: archive,
      iconOnly: true,
    });
  });

  test("without a declared action the pencil stays the icon button", () => {
    expect(compactHeaderPrimary([edit, activate])).toEqual({ action: edit, iconOnly: true });
  });

  test("an undeclared id falls back to the pencil", () => {
    expect(compactHeaderPrimary([edit, activate], "ghost")?.action.id).toBe("edit");
  });

  test("returns undefined when nothing declared may stand alone", () => {
    expect(compactHeaderPrimary([activate, terminate])).toBeUndefined();
    expect(compactHeaderPrimary([action("sync")])).toBeUndefined();
  });
});

describe("orderPlainHeaderActions", () => {
  test("moves the preferred action to the front and keeps the rest in order", () => {
    expect(orderPlainHeaderActions([edit, archive, activate], "activate").map((a) => a.id)).toEqual(
      ["activate", "edit", "archive"],
    );
  });

  test("leaves the order untouched without a (matching) preference", () => {
    const actions = [edit, activate];
    expect(orderPlainHeaderActions(actions)).toBe(actions);
    expect(orderPlainHeaderActions(actions, "ghost")).toBe(actions);
  });
});
