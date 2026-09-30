import { describe, expect, test } from "bun:test";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { NavProvider } from "@cosmicdrift/kumiko-renderer";
import { render, renderWithSidebar, screen } from "../../__tests__/test-utils";
import { DefaultPageHeader } from "../../primitives/page-header";
import { PageHeaderSlotProvider } from "../page-header-slot";
import { ShellHeader } from "../shell-header";

const emptySchema: AppSchema = { features: [] };

const routedSchema = {
  featureName: "showcase",
  entities: {},
  screens: [{ id: "orders", type: "entityList", entity: "x", columns: [] }],
  navs: [{ id: "orders", label: "Orders", screen: "orders", order: 10 }],
} as FeatureSchema;

const routedNav = {
  route: { screenId: "orders" },
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

describe("ShellHeader", () => {
  test("is 56px (h-14) and does not shrink with the icon rail", () => {
    renderWithSidebar(<ShellHeader schema={emptySchema} />);
    const header = screen.getByRole("banner");
    expect(header.className).toContain("h-14");
    expect(header.className).not.toContain("sidebar-wrapper:h-12");
  });

  test('carries the data-kumiko-layout="shell-header" marker that drives --shell-header-height', () => {
    renderWithSidebar(<ShellHeader schema={emptySchema} />);
    const header = screen.getByRole("banner");
    expect(header.getAttribute("data-kumiko-layout")).toBe("shell-header");
  });

  test("the last crumb is the page h1", () => {
    renderWithSidebar(
      <NavProvider value={routedNav}>
        <ShellHeader schema={routedSchema} />
      </NavProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Orders");
  });

  test("PageHeader portals status and actions into the header slots", () => {
    renderWithSidebar(
      <NavProvider value={routedNav}>
        <PageHeaderSlotProvider>
          <ShellHeader schema={routedSchema} />
          <DefaultPageHeader
            title="Order 17"
            status={<span data-testid="st">open</span>}
            actions={
              <button type="button" data-testid="act">
                Edit
              </button>
            }
          />
        </PageHeaderSlotProvider>
      </NavProvider>,
    );
    const status = document.querySelector("[data-kumiko-layout='page-header-status']");
    const actions = document.querySelector("[data-kumiko-layout='page-header-actions']");
    expect(status?.contains(screen.getByTestId("st"))).toBe(true);
    expect(actions?.contains(screen.getByTestId("act"))).toBe(true);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Order 17");
  });

  test("without a shell the PageHeader keeps the inline placement", () => {
    render(
      <DefaultPageHeader
        status={<span data-testid="st">open</span>}
        actions={
          <button type="button" data-testid="act">
            Edit
          </button>
        }
      />,
    );
    const inline = document.querySelector("[data-kumiko-layout='page-header-inline']");
    expect(inline?.contains(screen.getByTestId("st"))).toBe(true);
    expect(inline?.contains(screen.getByTestId("act"))).toBe(true);
  });
});
