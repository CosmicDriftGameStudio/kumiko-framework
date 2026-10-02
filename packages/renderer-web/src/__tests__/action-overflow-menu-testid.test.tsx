import { describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import { defaultPrimitives } from "../primitives/index.js";
import { render, screen } from "./test-utils.js";

const { ActionOverflowMenu } = defaultPrimitives;

describe("ActionOverflowMenu item testId", () => {
  test("a custom testId replaces the generated one and the item is clickable", async () => {
    if (ActionOverflowMenu === undefined) throw new Error("ActionOverflowMenu primitive missing");
    const onSelect = mock(() => {});
    render(
      <ActionOverflowMenu
        label="More"
        items={[
          { id: "a", label: "Alpha", testId: "custom-alpha", onSelect },
          { id: "b", label: "Beta", onSelect: () => {} },
        ]}
      />,
    );
    await userEvent.click(screen.getByTestId("action-overflow-menu-trigger"));
    expect(screen.queryByTestId("action-overflow-menu-item-a")).toBeNull();
    expect(screen.getByTestId("action-overflow-menu-item-b")).toBeTruthy();
    await userEvent.click(screen.getByTestId("custom-alpha"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
