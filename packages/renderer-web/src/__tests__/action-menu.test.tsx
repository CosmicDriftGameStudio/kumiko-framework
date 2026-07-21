import { describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionMenu, type MenuItemDef } from "../primitives/action-menu";

describe("ActionMenu", () => {
  test("renders trigger with aria-label and default testId", () => {
    render(
      <ActionMenu
        trigger={<span>Open</span>}
        triggerLabel="More actions"
        items={[{ kind: "item", id: "a", label: "Alpha", onSelect: () => {} }]}
      />,
    );
    const trigger = screen.getByTestId("action-menu-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("More actions");
    expect(screen.getByText("Open")).toBeTruthy();
  });

  test("opens menu: item, separator, label, shortcut, danger, icon", async () => {
    const user = userEvent.setup();
    const onSelect = mock(() => {});
    const items: MenuItemDef[] = [
      { kind: "label", label: "Section" },
      {
        kind: "item",
        id: "edit",
        label: "Edit",
        icon: <span data-testid="edit-icon">✎</span>,
        shortcut: "⌘E",
        onSelect,
      },
      { kind: "separator" },
      {
        kind: "item",
        id: "delete",
        label: "Delete",
        variant: "danger",
        onSelect: () => {},
      },
      {
        kind: "item",
        id: "disabled",
        label: "Disabled",
        disabled: true,
        onSelect: () => {},
      },
    ];

    render(
      <ActionMenu
        trigger={<span>Menu</span>}
        items={items}
        align="start"
        minWidth="12rem"
        testId="am"
      />,
    );
    await user.click(screen.getByTestId("am"));

    await waitFor(() => {
      expect(screen.getByText("Section")).toBeTruthy();
      expect(screen.getByTestId("action-menu-item-edit")).toBeTruthy();
      expect(screen.getByTestId("edit-icon")).toBeTruthy();
      expect(screen.getByText("⌘E")).toBeTruthy();
      expect(screen.getByTestId("action-menu-item-delete").className).toContain("text-destructive");
      expect(screen.getByTestId("action-menu-item-disabled").getAttribute("data-disabled")).toBe(
        "",
      );
    });

    await user.click(screen.getByTestId("action-menu-item-edit"));
    expect(onSelect).toHaveBeenCalled();
  });
});
