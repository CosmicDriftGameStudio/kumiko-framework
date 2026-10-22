import { describe, expect, test } from "bun:test";
import {
  createRegistry,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ListTableOptions } from "@cosmicdrift/kumiko-framework/ui-types";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { createTaskBoardFeature } from "../feature";

// The boot validator is the net for blocks the type system never sees (JS, generated features).
function featureWithBlock(block: object) {
  return createTaskBoardFeature(block as ListTableOptions);
}

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("list-table-options recipe", () => {
  test("the full table block boots and reaches the registered screen", () => {
    const feature = createTaskBoardFeature();
    expect(() => validateBoot([feature])).not.toThrow();
    const screen = createRegistry([feature]).getScreen("task-board:screen:task-list");
    expect(screen?.type === "entityList" ? screen.table : undefined).toEqual({
      rememberState: true,
      resetAll: true,
      columnPicker: true,
      density: { default: "comfortable", userChoice: true },
    });
  });

  test("a misspelled table key is rejected with the allowed keys", () => {
    expect(() => validateBoot([featureWithBlock({ rememberStatee: true })])).toThrow(
      /unknown key\(s\) "rememberStatee"\. Allowed keys: rememberState, resetAll, columnPicker, density/,
    );
  });

  test("a hidden column needs the column picker", () => {
    expect(() => validateBoot([featureWithBlock({ rememberState: true, resetAll: true })])).toThrow(
      /column "estimateHours" is hidden but table\.columnPicker is not enabled/,
    );
  });

  test("a density outside the union is rejected", () => {
    expect(() =>
      validateBoot([featureWithBlock({ columnPicker: true, density: { default: "tight" } })]),
    ).toThrow(/table\.density\.default is "tight"/);
  });
});
