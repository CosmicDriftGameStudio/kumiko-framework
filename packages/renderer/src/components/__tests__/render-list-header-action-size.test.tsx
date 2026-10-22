import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { cleanup, render, screen as rtlScreen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { PageHeaderSlotAvailableProvider } from "../../page-header-slot.ts";
import {
  type ButtonProps,
  type CorePrimitives,
  type DataTableProps,
  type PageHeaderProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import { RenderList, type ToolbarActionButton } from "../render-list.tsx";

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

const primaryAction: ToolbarActionButton = {
  id: "capture",
  label: "Capture",
  style: "primary",
  onTrigger: () => {},
};

function renderList(props: {
  readonly onCreate?: () => void;
  readonly toolbarActions?: readonly ToolbarActionButton[];
}): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={testPrimitives}>
        <PageHeaderSlotAvailableProvider value={true}>
          <RenderList
            screen={listScreen}
            entity={entity}
            rows={[]}
            featureName="header-fixture"
            {...props}
          />
        </PageHeaderSlotAvailableProvider>
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

function headerButtonSize(testId: string, props: Parameters<typeof renderList>[0]): string | null {
  renderList(props);
  const size = rtlScreen.getByTestId(testId).getAttribute("data-size");
  cleanup();
  return size;
}

describe("RenderList page-header action size", () => {
  test("a toolbar action promoted into the page header has the standard create button size", () => {
    const createSize = headerButtonSize("render-list-create", { onCreate: () => {} });
    const promotedSize = headerButtonSize("render-list-toolbar-action-capture", {
      toolbarActions: [primaryAction],
    });

    expect(promotedSize).toBe(createSize);
  });

  test("create plus two promotable toolbar actions give three header buttons, none in the toolbar", () => {
    renderList({
      onCreate: () => {},
      toolbarActions: [primaryAction, { ...primaryAction, id: "upload", label: "Upload" }],
    });
    const header = rtlScreen.getByRole("banner");
    const toolbar = rtlScreen.getByTestId("toolbar-end");
    const ids = (root: HTMLElement): (string | null)[] =>
      Array.from(root.querySelectorAll("button")).map((b) => b.getAttribute("data-testid"));
    expect(ids(header)).toEqual([
      "render-list-toolbar-action-capture",
      "render-list-toolbar-action-upload",
      "render-list-create",
    ]);
    expect(ids(toolbar)).toEqual([]);
  });
});
