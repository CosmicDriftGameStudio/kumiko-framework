import { describe, expect, test } from "bun:test";
import type { RenderEditAction } from "../../components/render-edit-types.js";
import {
  compactHeaderIconAction,
  orderPlainHeaderActions,
  primaryHeaderAction,
} from "../header-actions.js";

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

describe("compactHeaderIconAction", () => {
  test("a preferred action with a confirm cannot stand alone, so the pencil stays visible", () => {
    expect(compactHeaderIconAction([edit, activate], "activate")?.id).toBe("edit");
  });

  test("a plain preferred action becomes the icon button", () => {
    expect(compactHeaderIconAction([edit, archive], "archive")?.id).toBe("archive");
  });

  test("returns undefined when no candidate may stand alone", () => {
    expect(compactHeaderIconAction([activate, terminate], "activate")).toBeUndefined();
  });

  test("an icon-less action never becomes the icon button", () => {
    expect(compactHeaderIconAction([action("sync")])).toBeUndefined();
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
