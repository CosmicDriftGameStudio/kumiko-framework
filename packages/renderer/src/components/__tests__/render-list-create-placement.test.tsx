import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { render, screen as rtlScreen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import {
  PageHeaderCompactProvider,
  PageHeaderSlotAvailableProvider,
} from "../../page-header-slot.ts";
import {
  type ButtonProps,
  type CorePrimitives,
  type DataTableProps,
  type PageHeaderProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import { RenderList } from "../render-list.tsx";
import { withPlusIconFallback } from "../render-list-toolbar-model.ts";

const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId, size }) => (
  <button
    type="button"
    data-testid={testId}
    data-size={size ?? "md"}
    onClick={() => {
      void onClick?.();
    }}
  >
    {children}
  </button>
);

const TestPageHeader: ComponentType<PageHeaderProps> = ({ actions, overflowItems }) => (
  <header>
    {actions}
    {overflowItems?.map((item) => (
      <span key={item.id} data-testid={item.testId}>
        {item.label}
      </span>
    ))}
  </header>
);
const toolbarOnlyDataTable: ComponentType<DataTableProps> = ({ toolbarEnd }) => (
  <div data-testid="toolbar-end">{toolbarEnd}</div>
);
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: TestButton,
  PageHeader: TestPageHeader,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: toolbarOnlyDataTable,
  Form: passChildren,
  Section: passChildren,
  Card: passChildren,
  Grid: passChildren,
  GridCell: passChildren,
  Text: passChildren,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

const entity: EntityDefinition = {
  fields: {
    name: {
      type: "text",
      allowPlaintext: "test fixture value, not personal data",
      maxLength: 50,
      required: false,
      searchable: false,
      sortable: false,
    },
  },
};

const listScreen: EntityListScreenDefinition = {
  id: "widget-list",
  type: "entityList",
  entity: "widget",
  columns: ["name"],
};

const newContractAction = {
  id: "new-contract",
  label: "New contract",
  style: "primary",
  onTrigger: () => {},
} as const;

function renderList(
  compact: boolean,
  createPlacement: "header" | "toolbar",
  placement: Pick<EntityListScreenDefinition, "toolbarActionsPlacement"> = {},
  withAction = false,
): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={testPrimitives}>
        <PageHeaderSlotAvailableProvider value={true}>
          <PageHeaderCompactProvider value={compact}>
            <RenderList
              screen={{ ...listScreen, createPlacement, ...placement }}
              entity={entity}
              rows={[]}
              featureName="header-fixture"
              onCreate={() => {}}
              {...(withAction && { toolbarActions: [newContractAction] })}
            />
          </PageHeaderCompactProvider>
        </PageHeaderSlotAvailableProvider>
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderList createPlacement", () => {
  test("toolbar: one create button in the toolbar and none in the header when not compact", () => {
    renderList(false, "toolbar");
    expect(
      within(rtlScreen.getByTestId("toolbar-end")).getAllByTestId("render-list-create"),
    ).toHaveLength(1);
    expect(rtlScreen.queryByRole("banner")).toBeNull();
  });

  test("toolbar: a compact header keeps the only create button", () => {
    renderList(true, "toolbar");
    expect(rtlScreen.getAllByTestId("render-list-create")).toHaveLength(1);
    expect(within(rtlScreen.getByRole("banner")).getByTestId("render-list-create")).toBeTruthy();
  });

  test("header (default): the create button stays in the header", () => {
    renderList(false, "header");
    expect(within(rtlScreen.getByRole("banner")).getByTestId("render-list-create")).toBeTruthy();
    expect(
      within(rtlScreen.getByTestId("toolbar-end")).queryByTestId("render-list-create"),
    ).toBeNull();
  });
});

describe("RenderList toolbarActionsPlacement", () => {
  test("toolbar: from md the action is in the toolbar after the create button, not in the header", () => {
    renderList(false, "toolbar", { toolbarActionsPlacement: "toolbar" }, true);
    const toolbarEnd = rtlScreen.getByTestId("toolbar-end");
    const create = within(toolbarEnd).getByTestId("render-list-create");
    const action = within(toolbarEnd).getByTestId("render-list-toolbar-action-new-contract");
    expect(create.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rtlScreen.queryByRole("banner")).toBeNull();
  });

  test("toolbar: below md the action stays in the header", () => {
    renderList(true, "header", { toolbarActionsPlacement: "toolbar" }, true);
    expect(
      within(rtlScreen.getByRole("banner")).getByTestId("render-list-toolbar-action-new-contract"),
    ).toBeTruthy();
    expect(
      within(rtlScreen.getByTestId("toolbar-end")).queryByTestId(
        "render-list-toolbar-action-new-contract",
      ),
    ).toBeNull();
  });

  test("plus icon fallback: only for a sole icon-less primary action", () => {
    const second = { ...newContractAction, id: "other" };
    const withIcon = { ...newContractAction, id: "iconic", icon: "check" } as const;
    expect(withPlusIconFallback(newContractAction, [newContractAction]).icon).toBe("plus");
    expect(withPlusIconFallback(newContractAction, [newContractAction, withIcon]).icon).toBe(
      "plus",
    );
    expect(
      withPlusIconFallback(newContractAction, [newContractAction, second]).icon,
    ).toBeUndefined();
    expect(withPlusIconFallback(withIcon, [withIcon]).icon).toBe("check");
  });

  test("header (default): a primary action stands in the header", () => {
    renderList(false, "header", {}, true);
    expect(
      within(rtlScreen.getByRole("banner")).getByTestId("render-list-toolbar-action-new-contract"),
    ).toBeTruthy();
  });
});
