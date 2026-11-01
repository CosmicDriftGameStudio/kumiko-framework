import { describe, expect, test } from "bun:test";
import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { DispatcherProvider, RenderEdit } from "../../index.ts";
import { makeDispatcher, orderEntity, type TestValues } from "./_render-edit-helpers.tsx";
import { render, screen } from "./test-utils.tsx";

function renderOrder(hideRequiredMarker: boolean | undefined): void {
  const screenDef: EntityEditScreenDefinition = {
    id: "orders:screen:order-edit",
    type: "entityEdit",
    entity: "order",
    layout: {
      ...(hideRequiredMarker !== undefined && { hideRequiredMarker }),
      sections: [{ title: "Basics", columns: 1, fields: [{ field: "title" }, { field: "count" }] }],
    },
  };
  render(
    <DispatcherProvider dispatcher={makeDispatcher()}>
      <RenderEdit<TestValues>
        screen={screenDef}
        entity={orderEntity}
        featureName="orders"
        initial={{ title: "Acme", count: 1 } as TestValues}
        writeCommand="order:create"
      />
    </DispatcherProvider>,
  );
}

describe("layout.hideRequiredMarker", () => {
  test("the asterisk after a required label is shown by default", () => {
    renderOrder(undefined);
    expect(screen.getByTestId("field-title").textContent).toContain("*");
  });

  test("the asterisk is hidden when the layout opts out", () => {
    renderOrder(true);
    expect(screen.getByTestId("field-title").textContent).not.toContain("*");
  });
});
