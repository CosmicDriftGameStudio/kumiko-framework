// RenderEdit hands `fillHeight` to the Form only for a lone relatedList tab
// (tabs mode = `hideSectionTitles`, the relatedList is the active section):
// that table must scroll inside its tab panel. Every other layout keeps
// normal document-flow height.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import { type CorePrimitives, type FormProps, PrimitivesProvider } from "../../primitives.js";
import { RenderEdit } from "../render-edit.js";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const entity: EntityDefinition = {
  fields: {
    name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
  },
};

const fieldsSection = { title: "Basics", fields: ["name"] };
const relatedListSection = {
  kind: "relatedList" as const,
  title: "History",
  query: "widgets:query:history:list",
  columns: [{ field: "name" }],
};

function capturedFormFor(
  sections: EntityEditScreenDefinition["layout"]["sections"],
  hideSectionTitles: boolean,
): FormProps {
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
  const screen: EntityEditScreenDefinition = {
    id: "widget-edit",
    type: "entityEdit",
    entity: "widget",
    layout: { sections },
  };
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={primitives}>
        <RenderEdit
          screen={screen}
          entity={entity}
          featureName="widgets"
          initial={{ name: "" }}
          {...(hideSectionTitles && { hideSectionTitles: true })}
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
  if (captured === undefined) throw new Error("Form primitive was not rendered");
  return captured;
}

describe("RenderEdit fillHeight on the Form", () => {
  test("a relatedList as the active tab section sets fillHeight", () => {
    expect(capturedFormFor([relatedListSection], true).fillHeight).toBe(true);
  });

  test("a fields section as the active tab leaves fillHeight unset", () => {
    expect("fillHeight" in capturedFormFor([fieldsSection], true)).toBe(false);
  });

  test("a tab whose first section is fields leaves fillHeight unset even with a relatedList after it", () => {
    expect("fillHeight" in capturedFormFor([fieldsSection, relatedListSection], true)).toBe(false);
  });

  test("a stacked (non-tabs) layout with a relatedList leaves fillHeight unset", () => {
    expect("fillHeight" in capturedFormFor([relatedListSection], false)).toBe(false);
  });
});
