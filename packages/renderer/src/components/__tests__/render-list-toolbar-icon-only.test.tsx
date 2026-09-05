// ToolbarActionView collapses a group of >2 icon-carrying toolbar actions to
// icon-only buttons (`shouldRenderActionsIconOnly`). The button then has no
// accessible name from its children, so the label has to move to `ariaLabel`
// and must NOT stay in the children — otherwise the text renders inside a
// button sized for an icon.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { render, screen as rtlScreen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type ButtonProps,
  type CorePrimitives,
  type DataTableProps,
  PrimitivesProvider,
} from "../../primitives";
import { RenderList, type ToolbarActionButton } from "../render-list";

const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId, ariaLabel, size }) => (
  <button
    type="button"
    data-testid={testId}
    data-size={size ?? "md"}
    aria-label={ariaLabel}
    onClick={() => {
      void onClick?.();
    }}
  >
    {children}
  </button>
);

const toolbarOnlyDataTable: ComponentType<DataTableProps> = ({ toolbarEnd }) => (
  <div>{toolbarEnd}</div>
);

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: TestButton,
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
    name: { type: "text", maxLength: 50, required: false, searchable: false, sortable: false },
  },
};

const listScreen: EntityListScreenDefinition = {
  id: "widget-list",
  type: "entityList",
  entity: "widget",
  columns: ["name"],
};

function toolbarAction(id: string, label: string, withIcon: boolean): ToolbarActionButton {
  return {
    id,
    label,
    onTrigger: () => {},
    ...(withIcon && { icon: "archive" as const }),
  };
}

function renderToolbar(actions: readonly ToolbarActionButton[]): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={testPrimitives}>
        <RenderList
          screen={listScreen}
          entity={entity}
          rows={[]}
          featureName="toolbar-fixture"
          toolbarActions={actions}
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderList toolbar actions collapse to icon-only", () => {
  test("three icon actions render buttons with no visible text but an aria-label", () => {
    renderToolbar([
      toolbarAction("sync", "Sync", true),
      toolbarAction("export", "Export", true),
      toolbarAction("archive", "Archive", true),
    ]);

    for (const [id, label] of [
      ["sync", "Sync"],
      ["export", "Export"],
      ["archive", "Archive"],
    ] as const) {
      const button = rtlScreen.getByTestId(`render-list-toolbar-action-${id}`);
      expect(button.getAttribute("data-size")).toBe("icon");
      expect(button.getAttribute("aria-label")).toBe(label);
      expect(button.textContent).toBe("");
    }
  });

  test("two actions stay on text buttons carrying the label as children", () => {
    renderToolbar([toolbarAction("sync", "Sync", true), toolbarAction("export", "Export", true)]);

    const button = rtlScreen.getByTestId("render-list-toolbar-action-sync");
    expect(button.getAttribute("data-size")).toBe("md");
    expect(button.textContent).toBe("Sync");
  });

  test("an icon-less member keeps the whole group on text buttons", () => {
    renderToolbar([
      toolbarAction("sync", "Sync", true),
      toolbarAction("export", "Export", true),
      toolbarAction("archive", "Archive", false),
    ]);

    const button = rtlScreen.getByTestId("render-list-toolbar-action-sync");
    expect(button.getAttribute("data-size")).toBe("md");
    expect(button.textContent).toBe("Sync");
  });
});
