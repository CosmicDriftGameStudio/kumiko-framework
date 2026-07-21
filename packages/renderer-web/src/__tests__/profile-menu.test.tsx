import { describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileMenu } from "../layout/profile-menu";

describe("ProfileMenu", () => {
  test("wraps Avatar trigger and opens ActionMenu items", async () => {
    const user = userEvent.setup();
    const onSelect = mock(() => {});
    render(
      <ProfileMenu
        user={{ id: "u1", label: "Ada Lovelace" }}
        items={[
          { kind: "item", id: "profile", label: "View profile", onSelect },
          { kind: "separator" },
          { kind: "item", id: "out", label: "Sign out", variant: "danger", onSelect: () => {} },
        ]}
      />,
    );
    const trigger = screen.getByTestId("profile-menu-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("Open Ada Lovelace menu");
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByTestId("action-menu-item-profile")).toBeTruthy();
    });
    await user.click(screen.getByTestId("action-menu-item-profile"));
    expect(onSelect).toHaveBeenCalled();
  });
});
