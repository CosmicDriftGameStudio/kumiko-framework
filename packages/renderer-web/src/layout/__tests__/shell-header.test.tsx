import { describe, expect, test } from "bun:test";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { NavProvider } from "@cosmicdrift/kumiko-renderer";
import { render, renderWithSidebar, screen } from "../../__tests__/test-utils.js";
import { DefaultPageHeader } from "../../primitives/page-header.js";
import { PageHeaderSlotProvider } from "../page-header-slot.js";
import { ShellHeader } from "../shell-header.js";

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

  describe("edit screen that is also a nav entry", () => {
    const editSchema = {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "item-list", type: "entityList", entity: "item", columns: [] },
        { id: "item-edit", type: "entityEdit", entity: "item", listScreenId: "item-list" },
      ],
      navs: [
        { id: "item-list", label: "Items", screen: "item-list", order: 10 },
        { id: "item-new", label: "New item", screen: "item-edit", order: 20 },
      ],
    } as unknown as FeatureSchema;

    function crumbLabels(entityId: string | undefined): string[] {
      renderWithSidebar(
        <NavProvider
          value={{
            ...routedNav,
            route: { screenId: "item-edit", ...(entityId !== undefined && { entityId }) },
          }}
        >
          <ShellHeader schema={editSchema} />
        </NavProvider>,
      );
      return Array.from(document.querySelectorAll("[data-slot='breadcrumb-item']")).map(
        (item) => item.textContent ?? "",
      );
    }

    test("create route keeps the nav label as the only crumb", () => {
      expect(crumbLabels(undefined)).toEqual(["New item"]);
    });

    test("existing record shows the parent list before the title", () => {
      const labels = crumbLabels("item-1");
      expect(labels).toHaveLength(2);
      expect(labels[0]).toContain("item-list");
    });
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
