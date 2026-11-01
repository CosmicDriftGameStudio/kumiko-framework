import { describe, expect, test } from "bun:test";
import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { DispatcherProvider, ExtensionSectionsProvider, RenderEdit } from "../../index.ts";
import { TextField } from "../widgets/form-fields.tsx";
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

describe("layout.hideRequiredMarker and width on the wizard path", () => {
  function renderWizardOrder(extra: { hideRequiredMarker?: boolean; width?: "3xl" }): void {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        ...extra,
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
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
          fillScreenHeight
        />
      </DispatcherProvider>,
    );
  }

  test("the asterisk is shown by default", () => {
    renderWizardOrder({});
    expect(screen.getByTestId("field-title").textContent).toContain("*");
  });

  test("the asterisk is hidden with the opt-out", () => {
    renderWizardOrder({ hideRequiredMarker: true });
    expect(screen.getByTestId("field-title").textContent).not.toContain("*");
  });

  test("layout.width reaches the wizard form column", () => {
    renderWizardOrder({ width: "3xl" });
    const column = screen.getByTestId("field-title").closest(".max-w-3xl");
    expect(column).not.toBeNull();
  });
});

const RequiredName = (_: { entityName: string; entityId: string | null }) => (
  <TextField id="ext-name" name="ext-name" label="Name" value="" onChange={() => {}} required />
);

describe("layout.hideRequiredMarker reaches widgets in extension sections", () => {
  function renderWithExtension(hideRequiredMarker: boolean): void {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        hideRequiredMarker,
        sections: [
          {
            kind: "extension",
            title: "Custom",
            component: { react: { __component: "RequiredName" } },
          },
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ RequiredName }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 1 } as TestValues}
            writeCommand="order:create"
            fillScreenHeight
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );
  }

  test("the widget label shows no asterisk but the input stays aria-required", () => {
    renderWithExtension(true);
    expect(document.getElementById("ext-name-label")?.textContent).not.toContain("*");
    expect(screen.getByLabelText("Name").getAttribute("aria-required")).toBe("true");
  });

  test("the widget label shows the asterisk by default", () => {
    renderWithExtension(false);
    expect(document.getElementById("ext-name-label")?.textContent).toContain("*");
  });
});
