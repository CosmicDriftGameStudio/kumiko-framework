import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import type { FeatureSchema } from "../../../index.ts";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { DefaultAppShell } from "../default-app-shell.tsx";
import { useShellFocusMode } from "../shell-focus.tsx";

const schema = {
  featureName: "inbox",
  entities: {},
  screens: [
    { id: "inbox", type: "entityList", entity: "x", columns: [] },
    { id: "units", type: "entityList", entity: "x", columns: [] },
  ],
  navs: [
    { id: "inbox", label: "Posteingang", screen: "inbox", icon: "list", order: 10 },
    { id: "stock", label: "Bestand", icon: "building", order: 20 },
    { id: "units", label: "Einheiten", screen: "units", parent: "stock", order: 10 },
  ],
} as FeatureSchema;

function FocusedScreen(): ReactNode {
  useShellFocusMode();
  return <div data-testid="focused-screen" />;
}

function Harness({ initiallyFocused = true }: { readonly initiallyFocused?: boolean }): ReactNode {
  const [focused, setFocused] = useState(initiallyFocused);
  return (
    <DefaultAppShell
      brand={<span>Brand</span>}
      schema={schema}
      headerActions={<button type="button">Global action</button>}
    >
      <button type="button" onClick={() => setFocused((on) => !on)}>
        toggle focus
      </button>
      {focused && <FocusedScreen />}
    </DefaultAppShell>
  );
}

function sidebarCookie(): string {
  return document.cookie
    .split("; ")
    .filter((entry) => entry.startsWith("sidebar_state="))
    .join("");
}

describe("shell focus mode", () => {
  test("without a focused screen the shell keeps full nav, toggle and header actions", () => {
    render(<Harness initiallyFocused={false} />);
    expect(document.querySelector('[data-kumiko-layout="focus-rail"]')).toBeNull();
    expect(screen.getByPlaceholderText("Search navigation…")).toBeTruthy();
    expect(screen.getByText("Global action")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Toggle sidebar" }).length).toBeGreaterThan(0);
  });

  test("a focused screen shows one icon per top-level node, no search and no header chrome", () => {
    render(<Harness />);
    const rail = document.querySelector('[data-kumiko-layout="focus-rail"]');
    expect(rail).not.toBeNull();
    expect(rail?.querySelectorAll("nav > *").length).toBe(2);
    expect(screen.getByRole("link", { name: "Posteingang" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bestand" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search navigation…")).toBeNull();
    expect(screen.queryByText("Einheiten")).toBeNull();
    expect(screen.queryByText("Global action")).toBeNull();
    const header = screen.getByRole("banner");
    expect(header.querySelector('button[data-sidebar="trigger"]')).toBeNull();
  });

  test("clicking a section icon expands the sidebar without touching the sidebar cookie", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Bestand" }));
    expect(document.querySelector('[data-kumiko-layout="focus-rail"]')).toBeNull();
    expect(screen.getByText("Einheiten")).toBeTruthy();
    expect(sidebarCookie()).toBe("");
  });

  test("leaving the screen restores the user's own sidebar", () => {
    render(<Harness />);
    expect(document.querySelector('[data-kumiko-layout="focus-rail"]')).not.toBeNull();
    fireEvent.click(screen.getByText("toggle focus"));
    expect(document.querySelector('[data-kumiko-layout="focus-rail"]')).toBeNull();
    expect(screen.getByPlaceholderText("Search navigation…")).toBeTruthy();
    expect(screen.getByText("Global action")).toBeTruthy();
  });

  test("on mobile widths the focused header hides below md so the screen can bring its own bar", () => {
    render(<Harness />);
    expect(screen.getByRole("banner").className).toContain("max-md:hidden");
  });
});
