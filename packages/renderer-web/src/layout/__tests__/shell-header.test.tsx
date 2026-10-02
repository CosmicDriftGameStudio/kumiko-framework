import { describe, expect, test } from "bun:test";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { NavProvider, PageHeaderCompactProvider } from "@cosmicdrift/kumiko-renderer";
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

  test("recordTitle from the PageHeader becomes the middle crumb between list and h1", () => {
    const editSchema = {
      featureName: "showcase",
      entities: {},
      screens: [
        { id: "item-list", type: "entityList", entity: "item", columns: [] },
        { id: "item-edit", type: "entityEdit", entity: "item", listScreenId: "item-list" },
      ],
      navs: [{ id: "item-list", label: "Items", screen: "item-list", order: 10 }],
    } as unknown as FeatureSchema;
    renderWithSidebar(
      <NavProvider value={{ ...routedNav, route: { screenId: "item-edit", entityId: "item-1" } }}>
        <PageHeaderSlotProvider>
          <ShellHeader schema={editSchema} />
          <DefaultPageHeader title="Edit vehicle" recordTitle="VW Golf" />
        </PageHeaderSlotProvider>
      </NavProvider>,
    );
    const items = Array.from(document.querySelectorAll("[data-slot='breadcrumb-item']"));
    expect(items).toHaveLength(3);
    expect(items[1]?.textContent).toBe("VW Golf");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Edit vehicle");
    expect(items[2]?.contains(screen.getByRole("heading", { level: 1 }))).toBe(true);
    for (const parent of items.slice(0, 2)) {
      expect(parent.className).toContain("hidden");
      expect(parent.className).toContain("sm:inline-flex");
    }
    expect(items[2]?.className).not.toContain("hidden");
  });

  test("below sm the actions container is capped at half the header so the h1 keeps its width", () => {
    renderWithSidebar(
      <NavProvider value={routedNav}>
        <PageHeaderSlotProvider>
          <ShellHeader schema={routedSchema} />
        </PageHeaderSlotProvider>
      </NavProvider>,
    );
    const actions = document.querySelector("[data-kumiko-layout='page-header-actions']");
    const container = actions?.parentElement;
    expect(container?.className).toContain("max-w-[50%]");
    expect(container?.className).toContain("sm:max-w-none");
    expect(container?.className).toContain("min-w-0");
    expect(actions?.className).toContain("min-w-0");
  });

  test("phone: wide actions shrink inside a capped container, the h1 keeps truncating and the overflow trigger never shrinks", () => {
    // Compact set directly: the shared CI happy-dom does not reliably report
    // a resized viewport through matchMedia.
    renderWithSidebar(
      <NavProvider value={routedNav}>
        <PageHeaderSlotProvider>
          <PageHeaderCompactProvider value={true}>
            <ShellHeader schema={routedSchema} headerActions={<span>app actions</span>} />
          </PageHeaderCompactProvider>
          <DefaultPageHeader
            title="Order 17"
            actions={
              <button type="button" data-testid="wide-action">
                A very long primary action label that would push the title out
              </button>
            }
          />
        </PageHeaderSlotProvider>
      </NavProvider>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).toContain("truncate");
    const actions = document.querySelector("[data-kumiko-layout='page-header-actions']");
    expect(actions?.contains(screen.getByTestId("wide-action"))).toBe(true);
    expect(actions?.className).toContain("min-w-0");
    expect(actions?.className.split(" ")).toContain("overflow-hidden");
    expect(actions?.className).toContain("[&_button]:whitespace-nowrap");
    const container = actions?.parentElement;
    expect(container?.className).toContain("max-w-[60%]");
    expect(container?.className).toContain("min-w-0");
    expect(screen.getByTestId("shell-header-overflow-trigger").className).toContain("shrink-0");
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
