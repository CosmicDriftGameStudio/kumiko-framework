// Regression coverage for the hidden-section guards in render-edit.tsx
// (kumiko-framework#1731, from PR-review finding #1690): nothing previously
// asserted that a fully-hidden section actually stays out of the DOM.
//
// Two cases, verified by mutation-testing each guard in isolation:
//  - "Hidden": a "fields" section whose only field is condition-hidden — the
//    issue's literal ask. Redundantly guarded: both the
//    `filterEditSections(...).filter(...)` pass and the render loop's
//    `if (!section.visible) return null;` independently suppress it, so this
//    case only goes red if BOTH guards are removed.
//  - "Empty": a "fields" section declared with zero fields. fw#1901 keeps it
//    past the filter above on purpose (it isn't "hidden", it just has
//    nothing to hide), so its `visible` stays vacuously false and
//    `if (!section.visible) return null;` is the ONLY thing nulling it out —
//    this case is what actually pins that line, verified red when it's
//    neutralized. Not a shape a booted app can produce (boot-validator
//    rejects `fields.length === 0`), but RenderEdit's props aren't
//    boot-validated, so it's a real call shape worth guarding.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { type RenderResult, render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import { type CorePrimitives, PrimitivesProvider, type SectionProps } from "../../primitives";
import { RenderEdit } from "../render-edit";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
const renderSection: ComponentType<SectionProps> = ({ testId, children }) => (
  <div data-testid={testId}>{children}</div>
);

function testPrimitives(): CorePrimitives {
  return {
    Button: noop,
    Banner: noop,
    Field: passChildren,
    Input: noop,
    DataTable: noop,
    Form: passChildren,
    Section: renderSection,
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
}

function buildEntity(): EntityDefinition {
  return {
    fields: {
      name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
      secret: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
    },
  };
}

function renderEdit(screen: EntityEditScreenDefinition): RenderResult {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={testPrimitives()}>
        <RenderEdit
          screen={screen}
          entity={buildEntity()}
          featureName="widgets"
          initial={{ name: "", secret: "" }}
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderEdit — section with every field condition-hidden", () => {
  test("the visible section renders, the fully-hidden one does not reach the DOM", () => {
    const screen: EntityEditScreenDefinition = {
      id: "widget-edit",
      type: "entityEdit",
      entity: "widget",
      layout: {
        sections: [
          { title: "Visible", fields: ["name"] },
          { title: "Hidden", fields: [{ field: "secret", visible: false }] },
        ],
      },
    };

    const { getByTestId, queryByTestId } = renderEdit(screen);

    expect(getByTestId("section-Visible")).toBeDefined();
    expect(queryByTestId("section-Hidden")).toBeNull();
  });
});

describe("RenderEdit — section declared with zero fields", () => {
  test("the visible section renders, the empty one does not reach the DOM", () => {
    const screen: EntityEditScreenDefinition = {
      id: "widget-edit",
      type: "entityEdit",
      entity: "widget",
      layout: {
        sections: [
          { title: "Visible", fields: ["name"] },
          { title: "Empty", fields: [] },
        ],
      },
    };

    const { getByTestId, queryByTestId } = renderEdit(screen);

    expect(getByTestId("section-Visible")).toBeDefined();
    expect(queryByTestId("section-Empty")).toBeNull();
  });
});
