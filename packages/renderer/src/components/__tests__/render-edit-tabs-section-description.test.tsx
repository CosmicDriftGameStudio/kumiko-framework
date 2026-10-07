import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import { type CardProps, type CorePrimitives, PrimitivesProvider } from "../../primitives.js";
import { RenderEdit } from "../render-edit.js";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const entity: EntityDefinition = {
  fields: {
    name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
  },
};

const captureCard = ({ slots, testId, children }: CardProps): ReactNode => (
  <div data-testid={testId}>
    {slots?.subtitle !== undefined && <p data-testid={`${testId}-subtitle`}>{slots.subtitle}</p>}
    {children}
  </div>
);

function renderTabsMode(description: string | undefined): void {
  const screenDef: EntityEditScreenDefinition = {
    id: "widget-edit",
    type: "entityEdit",
    entity: "widget",
    layout: {
      mode: "tabs",
      sections: [
        { title: "Basics", fields: ["name"], ...(description !== undefined && { description }) },
      ],
    },
  };
  const primitives = {
    Button: noop,
    Banner: noop,
    Field: passChildren,
    Input: noop,
    DataTable: noop,
    Form: passChildren,
    Section: passChildren,
    Card: captureCard,
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
  } as unknown as CorePrimitives;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={primitives}>
        <RenderEdit
          screen={screenDef}
          entity={entity}
          featureName="widgets"
          initial={{ name: "" }}
          hideSectionTitles
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderEdit tabs mode — section description", () => {
  test("a fields section's description still renders as the card subtitle", () => {
    renderTabsMode("Shown under the tab strip.");
    expect(screen.getByTestId("section-Basics-subtitle").textContent).toBe(
      "Shown under the tab strip.",
    );
  });

  test("a section without description renders no subtitle", () => {
    renderTabsMode(undefined);
    expect(screen.getByTestId("section-Basics")).toBeTruthy();
    expect(screen.queryByTestId("section-Basics-subtitle")).toBeNull();
  });
});
