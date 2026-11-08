// Behaviour of the board-look follow-ups: header order, pinned action on list screens, plain phone cards,
// stand-in lists and the card footer link.

import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
  ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { LockedHeaderScope } from "../../app/locked-screen-header.tsx";
import { buildRecordActions } from "../../app/row-actions.ts";
import { type DataTableRowAction, RenderList } from "../../index.ts";
import { HeaderActionPinned } from "../layout/header-action-pinned.tsx";
import { HeaderScreenTypeContext } from "../layout/header-overflow-menu.ts";
import { PageHeaderSlotProvider } from "../layout/page-header-slot.tsx";
import { ShellHeader } from "../layout/shell-header.tsx";
import { defaultPrimitives } from "../primitives/index.tsx";
import {
  atViewportWidth,
  render,
  renderWithSidebar,
  restoreViewportWidthAfterEach,
  screen,
  setViewportWidth,
  within,
} from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;
const PHONE = 500;
const DESKTOP = 1280;

describe("shell header order", () => {
  restoreViewportWidthAfterEach();

  test("on a phone the pinned app action stands left of the overflow button", () => {
    setViewportWidth(PHONE);
    renderWithSidebar(
      <PageHeaderSlotProvider>
        <ShellHeader
          schema={{ features: [] }}
          headerActions={
            <>
              <HeaderActionPinned>
                <button type="button" data-testid="ai-trigger">
                  AI
                </button>
              </HeaderActionPinned>
              <button type="button">Other</button>
            </>
          }
        />
      </PageHeaderSlotProvider>,
    );
    const ai = screen.getByTestId("ai-trigger");
    const overflow = screen.getByTestId("shell-header-overflow-trigger");
    expect(ai.compareDocumentPosition(overflow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("HeaderActionPinned hideOnListScreens", () => {
  restoreViewportWidthAfterEach();

  function renderPinned(screenType: ScreenDefinition["type"]): void {
    renderWithSidebar(
      <PageHeaderSlotProvider>
        <ShellHeader schema={{ features: [] }} />
        <HeaderScreenTypeContext.Provider value={screenType}>
          <HeaderActionPinned hideOnListScreens>
            <button type="button" data-testid="ai-trigger">
              AI
            </button>
          </HeaderActionPinned>
        </HeaderScreenTypeContext.Provider>
      </PageHeaderSlotProvider>,
    );
  }

  test("a phone list screen drops the trigger", () => {
    setViewportWidth(PHONE);
    renderPinned("entityList");
    expect(screen.queryByTestId("ai-trigger")).toBeNull();
  });

  test("a phone record screen keeps it", () => {
    setViewportWidth(PHONE);
    renderPinned("projectionDetail");
    expect(screen.getByTestId("ai-trigger")).toBeTruthy();
  });

  test("desktop keeps it on a list screen", () => {
    setViewportWidth(DESKTOP);
    renderPinned("entityList");
    expect(screen.getByTestId("ai-trigger")).toBeTruthy();
  });
});

const COLUMNS = [
  { field: "name", label: "Name", type: "string", sortable: true },
  { field: "due", label: "Due", type: "string", sortable: true },
] as const;
const ROWS = [{ id: "r1", values: { name: "Alpha", due: "2026-01-01" } }];

describe("plainPhoneCards", () => {
  test("drops the sort line of the phone cards, the default keeps it", () => {
    atViewportWidth(PHONE, () => {
      const { unmount } = render(
        <DataTable columns={COLUMNS} rows={ROWS} sort={null} onSortChange={mock()} testId="t" />,
      );
      expect(screen.queryByTestId("t-sort")).not.toBeNull();
      unmount();
      render(
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          sort={null}
          onSortChange={mock()}
          plainPhoneCards
          testId="t"
        />,
      );
      expect(screen.queryByTestId("t-sort")).toBeNull();
    });
  });
});

describe("stand-in list", () => {
  restoreViewportWidthAfterEach();
  const entity = { fields: { title: { type: "text" } } } as unknown as EntityDefinition;
  const listScreen: EntityListScreenDefinition = {
    id: "tasks:screen:task-list",
    type: "entityList",
    entity: "task",
    columns: ["title"],
  };
  const list = (
    <RenderList
      screen={listScreen}
      entity={entity}
      rows={[{ id: "1", title: "Foo" }]}
      featureName="tasks"
      pager={{ page: 1, limit: 25, total: 60, onPageChange: mock() }}
      translate={(key) => key}
    />
  );

  test("a regular list shows the pager", () => {
    setViewportWidth(DESKTOP);
    renderWithSidebar(<PageHeaderSlotProvider>{list}</PageHeaderSlotProvider>);
    expect(document.querySelector("[data-testid$='pager-status']")).not.toBeNull();
  });

  test("a stand-in list shows neither pager nor count footer", () => {
    setViewportWidth(DESKTOP);
    renderWithSidebar(
      <PageHeaderSlotProvider>
        <LockedHeaderScope standInScreenId="tasks:screen:other">{list}</LockedHeaderScope>
      </PageHeaderSlotProvider>,
    );
    expect(screen.getByText("Foo")).toBeTruthy();
    expect(document.querySelector("[data-testid$='pager-status']")).toBeNull();
    expect(document.querySelector("[data-testid$='count-footer']")).toBeNull();
  });
});

describe("card footer link (F9)", () => {
  const LINK_COLUMNS = [
    COLUMNS[0],
    {
      field: "owner",
      label: "Owner",
      type: "string",
      sortable: false,
      linkFor: () => ({ href: "/o", onPress: () => {} }),
    },
  ] as const;
  const LINK_ROWS = [{ id: "u1", values: { name: "Anna", owner: "Beta GmbH" } }];
  const ai: DataTableRowAction = {
    id: "ai",
    label: "Ask AI",
    display: "responsive",
    icon: "sparkles",
    onTrigger: mock(),
  };

  test("without an AI action the link stays left under the meta", () => {
    atViewportWidth(PHONE, () => {
      render(
        <DataTable
          columns={LINK_COLUMNS}
          rows={LINK_ROWS}
          onRowClick={mock()}
          rowActions={[{ id: "pay", label: "Pay", display: "button", onTrigger: mock() }]}
          testId="t"
        />,
      );
      const links = screen.getByTestId("card-links-u1");
      expect(links.parentElement?.className).not.toContain("ml-auto");
      expect(links.parentElement?.parentElement?.firstElementChild).toBe(links.parentElement);
    });
  });

  test("with an AI action the pill stands left and the link moves right", () => {
    atViewportWidth(PHONE, () => {
      render(
        <DataTable
          columns={LINK_COLUMNS}
          rows={LINK_ROWS}
          onRowClick={mock()}
          rowActions={[ai]}
          testId="t"
        />,
      );
      const footer = screen.getByTestId("row-u1-card-buttons");
      const links = screen.getByTestId("card-links-u1");
      expect(links.parentElement?.className).toContain("ml-auto");
      expect(within(footer).getByText("Ask AI")).toBeTruthy();
    });
  });
});

describe("submitWith action without its mounted form", () => {
  test("writes nothing and names the problem", async () => {
    const write = mock(async () => ({ isSuccess: true, data: {} }));
    const actions = buildRecordActions({
      actions: [
        { kind: "writeHandler", id: "approve", label: "Approve", handler: "shop:write:approve" },
      ],
      record: { id: "r1" },
      translate: (key) => key,
      nav: {} as never,
      host: undefined,
      dispatcher: { write } as never,
      openDrawer: () => {},
      onWriteSuccess: () => {},
      writeForms: new Map(),
      submitWithIds: new Set(["approve"]),
    });
    await expect(actions?.[0]?.onPress()).rejects.toThrow("kumiko.writeForm.unavailable");
    expect(write).not.toHaveBeenCalled();
  });
});
