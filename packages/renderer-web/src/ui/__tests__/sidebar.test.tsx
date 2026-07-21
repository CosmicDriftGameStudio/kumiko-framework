import { afterEach, describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import { render as _render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithSidebar } from "../../__tests__/test-utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "../sidebar";

const MOBILE_WIDTH = 500;
const DESKTOP_WIDTH = 1024;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
}

function mockMobileViewport(mobile: boolean): void {
  setViewportWidth(mobile ? MOBILE_WIDTH : DESKTOP_WIDTH);
  window.matchMedia = ((query: string) => ({
    matches: mobile && query.includes("max-width"),
    media: query,
    addEventListener: (_event: string, listener: () => void) => {
      listener();
    },
    removeEventListener: () => {},
    dispatchEvent: () => true,
  })) as typeof window.matchMedia;
}

function SidebarOnly({ children }: { readonly children: ReactNode }): ReactNode {
  return <SidebarProvider>{children}</SidebarProvider>;
}

function renderSidebar(ui: ReactNode): ReturnType<typeof _render> {
  return _render(ui, { wrapper: SidebarOnly });
}

afterEach(() => {
  mockMobileViewport(false);
  document.cookie = "";
});

describe("ui/sidebar — useSidebar", () => {
  test("throws when used outside SidebarProvider", () => {
    function Bad(): ReactNode {
      useSidebar();
      return null;
    }
    expect(() => _render(<Bad />)).toThrow(/SidebarProvider/);
  });
});

describe("ui/sidebar — SidebarProvider", () => {
  test("controlled open + onOpenChange receives toggles", async () => {
    const user = userEvent.setup();
    const onOpenChange = mock<(open: boolean) => void>();
    _render(
      <SidebarProvider open={true} onOpenChange={onOpenChange}>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("uncontrolled setOpen writes sidebar_state cookie", async () => {
    const user = userEvent.setup();
    renderSidebar(<SidebarTrigger />);
    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(document.cookie).toContain("sidebar_state=false");
  });

  test("keyboard shortcut Ctrl+B toggles sidebar", async () => {
    renderSidebar(<SidebarTrigger />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true }),
    );
    await waitFor(() => {
      expect(document.cookie).toContain("sidebar_state=false");
    });
  });
});

describe("ui/sidebar — Sidebar layout branches", () => {
  test("collapsible=none renders static sidebar slot", () => {
    renderSidebar(
      <Sidebar collapsible="none" data-testid="static-sidebar">
        Nav
      </Sidebar>,
    );
    const el = screen.getByTestId("static-sidebar");
    expect(el.getAttribute("data-slot")).toBe("sidebar");
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  test("mobile viewport opens Sheet sidebar via trigger", async () => {
    const user = userEvent.setup();
    mockMobileViewport(true);
    renderSidebar(
      <>
        <SidebarTrigger />
        <Sidebar>
          <SidebarContent>Mobile nav</SidebarContent>
        </Sidebar>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    await waitFor(() => {
      expect(screen.getByText("Mobile nav")).toBeTruthy();
    });
    expect(document.querySelector('[data-slot="sidebar"][data-mobile="true"]')).not.toBeNull();
  });

  test.each([
    ["left", "sidebar"],
    ["right", "floating"],
    ["left", "inset"],
  ] as const)("desktop side=%s variant=%s sets data attributes", (side, variant) => {
    renderSidebar(
      <Sidebar side={side} variant={variant} collapsible="icon">
        <SidebarContent>Desktop</SidebarContent>
      </Sidebar>,
    );
    const root = document.querySelector('[data-slot="sidebar"][data-state]');
    expect(root?.getAttribute("data-side")).toBe(side);
    expect(root?.getAttribute("data-variant")).toBe(variant);
    expect(document.querySelector('[data-slot="sidebar-inner"]')).not.toBeNull();
  });
});

describe("ui/sidebar — subcomponents", () => {
  test("SidebarTrigger forwards onClick then toggles", async () => {
    const user = userEvent.setup();
    const onClick = mock<(event: MouseEvent) => void>();
    renderSidebar(<SidebarTrigger onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(onClick).toHaveBeenCalled();
  });

  test("SidebarRail toggles on click", async () => {
    const user = userEvent.setup();
    renderSidebar(
      <Sidebar collapsible="icon">
        <SidebarRail data-testid="rail" />
      </Sidebar>,
    );
    await user.click(screen.getByTestId("rail"));
    expect(document.cookie).toContain("sidebar_state=false");
  });

  test("structural slots render data-slot markers", () => {
    renderWithSidebar(
      <>
        <Sidebar>
          <SidebarHeader data-testid="hdr">H</SidebarHeader>
          <SidebarContent data-testid="cnt">C</SidebarContent>
          <SidebarFooter data-testid="ftr">F</SidebarFooter>
          <SidebarSeparator data-testid="sep" />
          <SidebarInput data-testid="inp" />
        </Sidebar>
        <SidebarInset data-testid="inset">Main</SidebarInset>
      </>,
    );
    expect(screen.getByTestId("hdr").getAttribute("data-slot")).toBe("sidebar-header");
    expect(screen.getByTestId("cnt").getAttribute("data-slot")).toBe("sidebar-content");
    expect(screen.getByTestId("ftr").getAttribute("data-slot")).toBe("sidebar-footer");
    expect(screen.getByTestId("sep").getAttribute("data-slot")).toBe("sidebar-separator");
    expect(screen.getByTestId("inp").getAttribute("data-slot")).toBe("sidebar-input");
    expect(screen.getByTestId("inset").getAttribute("data-slot")).toBe("sidebar-inset");
  });

  test("SidebarMenuButton without tooltip renders plain button", () => {
    renderWithSidebar(
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton data-testid="btn">Item</SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>,
    );
    expect(screen.getByTestId("btn").getAttribute("data-slot")).toBe("sidebar-menu-button");
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  });

  test.each([
    ["string tooltip", "Hint" as const],
    ["object tooltip", { children: "Hint" } as const],
  ])("SidebarMenuButton %s branch renders", (_label, tooltip) => {
    renderWithSidebar(
      <SidebarProvider defaultOpen={false}>
        <SidebarMenuButton tooltip={tooltip}>Item</SidebarMenuButton>
      </SidebarProvider>,
    );
    expect(screen.getByText("Item")).toBeTruthy();
    expect(document.querySelector('[data-sidebar="menu-button"]')).not.toBeNull();
  });

  test.each(["default", "outline"] as const)("SidebarMenuButton variant=%s", (variant) => {
    renderWithSidebar(
      <SidebarMenuButton variant={variant} data-testid="btn">
        V
      </SidebarMenuButton>,
    );
    expect(screen.getByTestId("btn").className.length).toBeGreaterThan(0);
  });

  test("SidebarMenuAction showOnHover + badge + skeleton", () => {
    renderWithSidebar(
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton>Item</SidebarMenuButton>
          <SidebarMenuAction showOnHover aria-label="act" />
          <SidebarMenuBadge>3</SidebarMenuBadge>
        </SidebarMenuItem>
        <SidebarMenuSkeleton showIcon data-testid="skel" />
      </SidebarMenu>,
    );
    expect(document.querySelector('[data-slot="sidebar-menu-action"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="sidebar-menu-badge"]')?.textContent).toBe("3");
    expect(screen.getByTestId("skel").querySelector('[data-sidebar="menu-skeleton-icon"]')).not.toBeNull();
  });

  test("SidebarGroup + sub-menu branches", () => {
    renderWithSidebar(
      <SidebarGroup data-testid="grp">
        <SidebarGroupLabel asChild>
          <span>Label</span>
        </SidebarGroupLabel>
        <SidebarGroupAction aria-label="group-act" />
        <SidebarGroupContent data-testid="grpc">Body</SidebarGroupContent>
        <SidebarMenuSub data-testid="sub">
          <SidebarMenuSubItem>
            <SidebarMenuSubButton size="sm" isActive href="#">
              Sub
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      </SidebarGroup>,
    );
    expect(screen.getByTestId("grp").getAttribute("data-slot")).toBe("sidebar-group");
    expect(screen.getByTestId("grpc").textContent).toBe("Body");
    expect(screen.getByTestId("sub").getAttribute("data-slot")).toBe("sidebar-menu-sub");
    expect(document.querySelector('[data-slot="sidebar-menu-sub-button"]')?.getAttribute("data-active")).toBe(
      "true",
    );
  });
});









