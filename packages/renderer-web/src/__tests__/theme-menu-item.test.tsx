import { describe, expect, mock, test } from "bun:test";
import { TokensProvider } from "@cosmicdrift/kumiko-renderer";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeMenuItem } from "../layout/theme-menu-item.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../primitives/dropdown-menu.js";

function renderInOpenMenu(mode: "light" | "dark", toggleMode: () => void) {
  const api = { tokens: {} as never, mode, setMode: () => {}, toggleMode };
  return render(
    <TokensProvider value={api}>
      <DropdownMenu>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ThemeMenuItem />
        </DropdownMenuContent>
      </DropdownMenu>
    </TokensProvider>,
  );
}

describe("ThemeMenuItem", () => {
  test("offers the opposite mode and toggles on select", async () => {
    const toggleMode = mock();
    renderInOpenMenu("light", toggleMode);
    await userEvent.setup().click(screen.getByText("open"));
    await userEvent.setup().click(screen.getByText("Dark theme"));
    expect(toggleMode).toHaveBeenCalledTimes(1);
  });

  test("in dark mode it offers the light mode", async () => {
    renderInOpenMenu("dark", mock());
    await userEvent.setup().click(screen.getByText("open"));
    expect(screen.getByText("Light theme")).toBeTruthy();
  });
});
