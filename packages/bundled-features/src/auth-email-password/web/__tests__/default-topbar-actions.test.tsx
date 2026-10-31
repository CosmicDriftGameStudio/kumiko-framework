import { describe, expect, test } from "bun:test";
import { TokensProvider } from "@cosmicdrift/kumiko-renderer";
import { defaultTokens } from "@cosmicdrift/kumiko-renderer/web";
import { screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { DefaultTopbarActions } from "../default-topbar-actions.tsx";
import { makeSessionApi, renderWithProviders } from "./test-utils.tsx";

const tokensValue = {
  tokens: defaultTokens,
  mode: "light" as const,
  setMode: () => {},
  toggleMode: () => {},
};

function renderActions(ui: ReactElement) {
  return renderWithProviders(<TokensProvider value={tokensValue}>{ui}</TokensProvider>, {
    session: makeSessionApi(),
  });
}

describe("DefaultTopbarActions", () => {
  test("renders the user menu by default", () => {
    renderActions(<DefaultTopbarActions />);
    expect(screen.getByRole("button", { name: /Test User/ })).toBeTruthy();
  });

  test("userMenu false omits the user menu", () => {
    renderActions(<DefaultTopbarActions userMenu={false} />);
    expect(screen.queryByRole("button", { name: /Test User/ })).toBeNull();
  });

  test("themeToggleTestId is forwarded to the theme toggle", () => {
    renderActions(<DefaultTopbarActions themeToggleTestId="theme-toggle" />);
    expect(screen.getByTestId("theme-toggle")).toBeTruthy();
  });
});
