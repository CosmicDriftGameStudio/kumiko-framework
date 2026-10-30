import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import type { FeatureSchema } from "../../../index.ts";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { useShellFocusMode } from "../shell-focus.tsx";
import { SidebarBrand } from "../sidebar-brand.tsx";
import { WorkspaceShell } from "../workspace-shell.tsx";

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
  return null;
}

function Harness({ focused }: { readonly focused: boolean }): ReactNode {
  return (
    <WorkspaceShell
      brand={<span>Brand</span>}
      schema={schema}
      topbarActions={<button type="button">Global action</button>}
      sidebarFooter={<span>Footer row</span>}
    >
      {focused && <FocusedScreen />}
    </WorkspaceShell>
  );
}

describe("WorkspaceShell focus mode", () => {
  test("without a focused screen the full navigation and footer are shown", () => {
    render(<Harness focused={false} />);
    expect(document.querySelector('[data-kumiko-layout="focus-rail"]')).toBeNull();
    expect(screen.getByPlaceholderText("Search navigation…")).toBeTruthy();
    expect(screen.getByText("Footer row")).toBeTruthy();
    expect(screen.getByText("Global action")).toBeTruthy();
  });

  test("a focused screen collapses to the icon rail without labels, footer or header actions", () => {
    render(<Harness focused />);
    const rail = document.querySelector('[data-kumiko-layout="focus-rail"]');
    expect(rail).not.toBeNull();
    expect(rail?.querySelectorAll("nav > *").length).toBe(2);
    expect(screen.queryByPlaceholderText("Search navigation…")).toBeNull();
    expect(screen.queryByText("Footer row")).toBeNull();
    expect(screen.queryByText("Global action")).toBeNull();
    expect(screen.queryByText("Posteingang")).toBeNull();
    expect(document.querySelector('[data-kumiko-layout="sidebar-footer"]')).toBeNull();
    expect(screen.getByRole("banner").querySelector('button[data-sidebar="trigger"]')).toBeNull();
  });

  test("rail tiles and brand tile follow the design: 40px md tiles, muted icons, 32px md brand tile", () => {
    render(
      <WorkspaceShell brand={<SidebarBrand name="Vermieter" />} schema={schema}>
        <FocusedScreen />
      </WorkspaceShell>,
    );
    const tile = document.querySelector('[data-kumiko-layout="focus-rail"] nav > *');
    expect(tile?.className).toContain("size-10");
    expect(tile?.className).toContain("rounded-md");
    expect(tile?.className).toContain("text-sidebar-muted");
    const brandTile = screen.getByText("V");
    expect(brandTile.parentElement?.className).toContain(
      "group-data-[focus-rail]/focus-rail:size-8",
    );
    expect(brandTile.parentElement?.className).toContain(
      "group-data-[focus-rail]/focus-rail:rounded-md",
    );
  });
});
