import { describe, expect, test } from "bun:test";
import type {
  EditFieldSpec,
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  type ColumnRendererProps,
  ColumnRenderersProvider,
  RenderEdit,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactElement, ReactNode } from "react";
import { render, screen } from "./test-utils";

// fw#2245 Teil 1: `EditFieldSpec.renderer` (kumiko-types/src/screen.ts) is
// validated and survives into the ViewModel (headless/view-model/edit.ts)
// but render-field.tsx never read it — the same FieldRenderer mechanism
// that already works for relatedList/entityList columns (render-list.tsx,
// see render-list-column-renderer.test.tsx) was a no-op for header fields.

const invoiceEntity = {
  fields: {
    title: { type: "text" },
    status: { type: "text" },
  },
} as unknown as EntityDefinition;

function makeScreen(statusField: EditFieldSpec): EntityEditScreenDefinition {
  return {
    id: "invoices:screen:invoice-detail",
    type: "entityEdit",
    entity: "invoice",
    layout: {
      sections: [{ fields: ["title", statusField] }],
    },
  };
}

const noopSubmit = async (): Promise<{
  readonly isSuccess: true;
  readonly validationBlocked: false;
  readonly data: undefined;
}> => ({ isSuccess: true, validationBlocked: false, data: undefined });

function StatusBadge({ value, row, column }: ColumnRendererProps): ReactNode {
  return (
    <span data-testid="status-badge">
      <span data-testid="status-badge-value">{String(value)}</span>
      <span data-testid="status-badge-field">{column.field}</span>
      <span data-testid="status-badge-row-title">{String(row["title"] ?? "")}</span>
    </span>
  );
}

function withRenderers(ui: ReactNode, map: Record<string, typeof StatusBadge>): ReactElement {
  return <ColumnRenderersProvider value={map}>{ui}</ColumnRenderersProvider>;
}

describe("RenderField — field.renderer on a readOnly head field (fw#2245)", () => {
  test("FormatSpec renderer formats the value instead of a disabled Input", () => {
    render(
      <RenderEdit
        screen={makeScreen({
          field: "status",
          readOnly: true,
          renderer: { format: "currency", symbol: "€" },
        })}
        entity={invoiceEntity}
        featureName="invoices"
        initial={{ title: "Alpha", status: "42" }}
        customSubmit={noopSubmit}
      />,
    );

    expect(screen.getByTestId("field-value-status").textContent).toBe("42 €");
    expect(screen.getByTestId("field-status").querySelector("input")).toBeNull();
  });

  test("__component renderer mounts the registry component with value+row+column", () => {
    render(
      withRenderers(
        <RenderEdit
          screen={makeScreen({
            field: "status",
            readOnly: true,
            renderer: { react: { __component: "StatusBadge" } },
          })}
          entity={invoiceEntity}
          featureName="invoices"
          initial={{ title: "Alpha", status: "shipped" }}
          customSubmit={noopSubmit}
        />,
        { StatusBadge },
      ),
    );

    expect(screen.getByTestId("status-badge")).toBeTruthy();
    expect(screen.getByTestId("status-badge-value").textContent).toBe("shipped");
    expect(screen.getByTestId("status-badge-field").textContent).toBe("status");
    expect(screen.getByTestId("status-badge-row-title").textContent).toBe("Alpha");
  });

  // A renderer isn't an editable widget — applying it to an editable field
  // would silently make that field un-editable. The gate is `field.readOnly`,
  // not "renderer is set".
  test("renderer on an editable field is ignored — the field keeps its editable Input", () => {
    render(
      <RenderEdit
        screen={makeScreen({ field: "status", renderer: { format: "currency", symbol: "€" } })}
        entity={invoiceEntity}
        featureName="invoices"
        initial={{ title: "Alpha", status: "42" }}
        customSubmit={noopSubmit}
      />,
    );

    const input = screen.getByTestId("field-status").querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.value).toBe("42");
  });
});
