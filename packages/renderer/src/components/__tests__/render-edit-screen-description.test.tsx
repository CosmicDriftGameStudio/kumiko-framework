// Regression coverage for kumiko-framework#2723: `EntityEditScreenDefinition.
// description` / `ActionFormScreenDefinition.description` existed in the type
// but was never rendered anywhere — used only as agent/API metadata
// (packages/framework/src/api/server.ts). RenderEdit now renders it as the
// form's subtitle, same visual slot section.description already fills for a
// section (render-edit.tsx's `Section`), falling back to it only when no
// `screen:<id>.subtitle` i18n override is set.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import { type CorePrimitives, type FormProps, PrimitivesProvider } from "../../primitives";
import { RenderEdit } from "../render-edit";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

function buildEntity(): EntityDefinition {
  return {
    fields: {
      name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
    },
  };
}

function renderEditCapturingForm(screen: EntityEditScreenDefinition): {
  captured: FormProps | undefined;
} {
  let captured: FormProps | undefined;
  const capturingForm = (props: FormProps): ReactNode => {
    captured = props;
    return props.children;
  };
  const primitives: CorePrimitives = {
    Button: noop,
    Banner: noop,
    Field: passChildren,
    Input: noop,
    DataTable: noop,
    Form: capturingForm,
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
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={primitives}>
        <RenderEdit
          screen={screen}
          entity={buildEntity()}
          featureName="widgets"
          initial={{ name: "" }}
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
  return { captured };
}

describe("RenderEdit — screen.description as form subtitle (fw#2723)", () => {
  test("a screen with description renders it as the form's subtitle", () => {
    const screen: EntityEditScreenDefinition = {
      id: "widget-edit",
      type: "entityEdit",
      entity: "widget",
      description: "Edit the widget's basic details.",
      layout: { sections: [{ title: "Basics", fields: ["name"] }] },
    };

    const { captured } = renderEditCapturingForm(screen);

    expect(captured?.subtitle).toBe("Edit the widget's basic details.");
  });

  test("a screen without description renders no subtitle prop at all (no empty placeholder)", () => {
    const screen: EntityEditScreenDefinition = {
      id: "widget-edit",
      type: "entityEdit",
      entity: "widget",
      layout: { sections: [{ title: "Basics", fields: ["name"] }] },
    };

    const { captured } = renderEditCapturingForm(screen);

    expect(captured).toBeDefined();
    expect(captured && "subtitle" in captured).toBe(false);
  });
});
