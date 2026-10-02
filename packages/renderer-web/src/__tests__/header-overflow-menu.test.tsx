// Phone header overflow: a right-aligned menu (not a full-width panel) with
// labelled rows, arrow-key navigation and the primary list toolbar action
// promoted into the header.

import { afterEach, describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ActionMenuItemSpec } from "@cosmicdrift/kumiko-renderer";
import { RenderList, TokensProvider, usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { PageHeaderSlotProvider } from "../layout/page-header-slot.js";
import { ShellHeader } from "../layout/shell-header.js";
import { ThemeToggle } from "../layout/theme-toggle.js";
import { fireEvent, renderWithSidebar, screen, within } from "./test-utils.js";

const PHONE = 500;
const DESKTOP = 1024;
const originalWidth = window.innerWidth;

function setViewportWidth(width: number): void {
  (
    window as unknown as { happyDOM: { setInnerWidth: (n: number) => void } }
  ).happyDOM.setInnerWidth(width);
}

afterEach(() => setViewportWidth(originalWidth));

type ToolbarActionButton = NonNullable<Parameters<typeof RenderList>[0]["toolbarActions"]>[number];

const emptySchema = { features: [] };

const taskEntity = {
  fields: { title: { type: "text", sortable: true } },
} as unknown as EntityDefinition;

const listScreen: EntityListScreenDefinition = {
  id: "tasks:screen:task-list",
  type: "entityList",
  entity: "task",
  columns: ["title"],
};

function tokensApi(mode: "light" | "dark", toggleMode: () => void) {
  return { tokens: {} as never, mode, setMode: () => {}, toggleMode };
}

function HeaderItems({ items }: { readonly items: readonly ActionMenuItemSpec[] }): ReactNode {
  const { PageHeader } = usePrimitives();
  return PageHeader !== undefined ? <PageHeader overflowItems={items} /> : null;
}

function renderHeader(toggleMode: () => void, mode: "light" | "dark" = "light") {
  const items: ActionMenuItemSpec[] = [
    { id: "duplicate", label: "Duplicate", onSelect: () => {} },
    { id: "archive", label: "Archive", onSelect: () => {} },
  ];
  renderWithSidebar(
    <TokensProvider value={tokensApi(mode, toggleMode)}>
      <PageHeaderSlotProvider>
        <ShellHeader
          schema={emptySchema}
          headerActions={
            <div className="flex items-center gap-2">
              <ThemeToggle testId="theme" />
            </div>
          }
        />
        <HeaderItems items={items} />
      </PageHeaderSlotProvider>
    </TokensProvider>,
  );
}

describe("header overflow menu", () => {
  test("an item testId overrides the default data-testid and the item is clickable", () => {
    setViewportWidth(PHONE);
    const onSelect = mock(() => {});
    renderWithSidebar(
      <PageHeaderSlotProvider>
        <ShellHeader schema={emptySchema} />
        <HeaderItems
          items={[
            { id: "export", label: "Export", testId: "my-export", onSelect },
            { id: "plain", label: "Plain", onSelect: () => {} },
          ]}
        />
      </PageHeaderSlotProvider>,
    );
    fireEvent.click(screen.getByTestId("shell-header-overflow-trigger"));
    expect(screen.queryByTestId("shell-header-overflow-item-export")).toBeNull();
    expect(screen.getByTestId("shell-header-overflow-item-plain")).toBeTruthy();
    fireEvent.click(screen.getByTestId("my-export"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("is a right-aligned menu with menuitem rows, not a full-width panel", () => {
    setViewportWidth(PHONE);
    renderHeader(() => {});
    const panel = screen.getByTestId("shell-header-overflow");
    const trigger = screen.getByTestId("shell-header-overflow-trigger");
    expect(panel.getAttribute("role")).toBe("menu");
    expect(panel.getAttribute("aria-label")).toBe("Page actions");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(panel.className).toContain("right-2");
    expect(panel.className).not.toContain("inset-x");
    const rows = within(panel).getAllByRole("menuitem", { hidden: true });
    expect(rows.map((row) => row.textContent)).toEqual(["Duplicate", "Archive", "☾Dark theme"]);
  });

  test("the theme toggle is a labelled row that switches the mode and closes the menu", () => {
    setViewportWidth(PHONE);
    const toggleMode = mock(() => {});
    renderHeader(toggleMode);
    const panel = screen.getByTestId("shell-header-overflow");
    fireEvent.click(screen.getByTestId("shell-header-overflow-trigger"));
    fireEvent.click(within(panel).getByText("Dark theme"));
    expect(toggleMode).toHaveBeenCalledTimes(1);
    expect(panel.hidden).toBe(true);
  });

  test("in dark mode the row offers the light theme", () => {
    setViewportWidth(PHONE);
    renderHeader(() => {}, "dark");
    expect(
      within(screen.getByTestId("shell-header-overflow")).getByText("Light theme"),
    ).toBeTruthy();
  });

  test("opening focuses the first row, arrows cycle, Home/End jump, Escape returns focus", () => {
    setViewportWidth(PHONE);
    renderHeader(() => {});
    const panel = screen.getByTestId("shell-header-overflow");
    const trigger = screen.getByTestId("shell-header-overflow-trigger");
    fireEvent.click(trigger);
    const [first, second, third] = within(panel).getAllByRole("menuitem") as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "End" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: "Home" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  test("Tab on a menu row closes the menu and returns focus to the trigger", () => {
    setViewportWidth(PHONE);
    renderHeader(() => {});
    const panel = screen.getByTestId("shell-header-overflow");
    const trigger = screen.getByTestId("shell-header-overflow-trigger");
    fireEvent.click(trigger);
    fireEvent.keyDown(within(panel).getAllByRole("menuitem")[0] as HTMLElement, { key: "Tab" });
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  test("keys on opaque header actions are not hijacked by the menu", () => {
    setViewportWidth(PHONE);
    renderWithSidebar(
      <PageHeaderSlotProvider>
        <ShellHeader
          schema={emptySchema}
          headerActions={
            <div>
              <button type="button" data-testid="plain-button">
                Plain
              </button>
              <input data-testid="search-input" />
            </div>
          }
        />
      </PageHeaderSlotProvider>,
    );
    const panel = screen.getByTestId("shell-header-overflow");
    fireEvent.click(screen.getByTestId("shell-header-overflow-trigger"));
    const input = screen.getByTestId("search-input");
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Tab"]) {
      const notCancelled = fireEvent.keyDown(input, { key });
      expect(notCancelled).toBe(true);
    }
    expect(panel.hidden).toBe(false);
    const button = screen.getByTestId("plain-button");
    expect(fireEvent.keyDown(button, { key: "Tab" })).toBe(true);
    expect(panel.hidden).toBe(false);
  });
});

describe("primary toolbar action in the header", () => {
  function action(overrides: Partial<ToolbarActionButton> = {}): ToolbarActionButton {
    return {
      id: "new",
      label: "New credit",
      style: "primary",
      confirmRequired: false,
      onTrigger: () => {},
      ...overrides,
    };
  }

  function renderList(options: {
    readonly toolbarActions: readonly ToolbarActionButton[];
    readonly onCreate?: () => void;
  }): void {
    renderWithSidebar(
      <PageHeaderSlotProvider>
        <ShellHeader schema={emptySchema} />
        <RenderList
          screen={listScreen}
          entity={taskEntity}
          rows={[{ id: "1", title: "Foo" }]}
          featureName="tasks"
          toolbarActions={options.toolbarActions}
          {...(options.onCreate !== undefined && { onCreate: options.onCreate })}
          translate={(key) => `T(${key})`}
        />
      </PageHeaderSlotProvider>,
    );
  }

  const inHeader = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(
      '[data-kumiko-layout="page-header-actions"] [data-testid="render-list-toolbar-action-new"]',
    );

  test("on phones it becomes an icon button in the header and fires onTrigger", () => {
    setViewportWidth(PHONE);
    const onTrigger = mock(() => {});
    renderList({ toolbarActions: [action({ onTrigger })] });
    const button = inHeader();
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("New credit");
    expect(button?.textContent).toBe("");
    expect(screen.getAllByTestId("render-list-toolbar-action-new")).toHaveLength(1);
    fireEvent.click(button as HTMLElement);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  test("on desktop it stays a text button in the toolbar", () => {
    setViewportWidth(DESKTOP);
    renderList({ toolbarActions: [action()] });
    expect(inHeader()).toBeNull();
    expect(screen.getByTestId("render-list-toolbar-action-new").textContent).toContain(
      "New credit",
    );
  });

  test("with onCreate only the create button takes the header", () => {
    setViewportWidth(PHONE);
    renderList({ toolbarActions: [action()], onCreate: () => {} });
    expect(inHeader()).toBeNull();
    expect(screen.getByTestId("render-list-create")).toBeTruthy();
    expect(screen.getByTestId("render-list-toolbar-action-new").textContent).toContain(
      "New credit",
    );
  });

  test("a failing promoted action surfaces its error instead of an unhandled rejection", async () => {
    setViewportWidth(PHONE);
    renderList({
      toolbarActions: [
        action({
          onTrigger: async () => {
            throw new Error("boom");
          },
        }),
      ],
    });
    fireEvent.click(inHeader() as HTMLElement);
    expect(await screen.findByText("boom")).toBeTruthy();
  });

  test("an action without an icon is still promoted, with the plus icon", () => {
    setViewportWidth(PHONE);
    renderList({ toolbarActions: [action()] });
    expect(inHeader()).not.toBeNull();
  });

  test("actions needing a confirm dialog stay in the toolbar", () => {
    setViewportWidth(PHONE);
    renderList({ toolbarActions: [action({ confirm: "Sure?" })] });
    expect(inHeader()).toBeNull();
  });
});
