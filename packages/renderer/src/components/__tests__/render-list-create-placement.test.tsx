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

const TestPageHeader: ComponentType<PageHeaderProps> = ({ actions }) => <header>{actions}</header>;
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

function renderList(compact: boolean, createPlacement: "header" | "toolbar"): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={testPrimitives}>
        <PageHeaderSlotAvailableProvider value={true}>
          <PageHeaderCompactProvider value={compact}>
            <RenderList
              screen={{ ...listScreen, createPlacement }}
              entity={entity}
              rows={[]}
              featureName="header-fixture"
              onCreate={() => {}}
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
