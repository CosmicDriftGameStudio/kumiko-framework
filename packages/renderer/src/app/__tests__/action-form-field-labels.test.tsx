// fw akte-bedienkonzept-2 F1: ActionFormScreenDefinition.fieldLabels mirrors
// EntityEditScreenDefinition.fieldLabels — a per-screen label override for a
// field that reuses the DEFAULT actionForm namespace elsewhere (e.g. a date
// field named "dueAt" needs a different label in this one actionForm than in
// another). Reuses the same synthesizeActionFormScreen → RenderEdit →
// computeEditViewModel label-resolution pipeline as entityEdit — no
// duplicated logic, see action-form-shim.ts.

import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { RenderEdit } from "../../components/render-edit";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import { type CorePrimitives, type FieldProps, PrimitivesProvider } from "../../primitives";
import { synthesizeActionFormEntity, synthesizeActionFormScreen } from "../action-form-shim";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

function renderActionFormCapturingFieldLabels(screen: ActionFormScreenDefinition): {
  labels: Record<string, string>;
} {
  const labels: Record<string, string> = {};
  const capturingField = (props: FieldProps): ReactNode => {
    if (props.testId !== undefined) labels[props.testId] = props.label;
    return props.children;
  };
  const primitives: CorePrimitives = {
    Button: noop,
    Banner: noop,
    Field: capturingField,
    Input: noop,
    DataTable: noop,
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
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={primitives}>
        <RenderEdit
          screen={synthesizeActionFormScreen(screen)}
          entity={synthesizeActionFormEntity(screen.fields)}
          featureName="shop"
          initial={{ dueAt: "" }}
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
  return { labels };
}

describe("RenderEdit — ActionFormScreenDefinition.fieldLabels (fw akte-bedienkonzept-2 F1)", () => {
  test("a field named in fieldLabels renders the screen's own label", () => {
    const screen: ActionFormScreenDefinition = {
      id: "reschedule",
      type: "actionForm",
      handler: "shop:write:reschedule",
      fields: { dueAt: { type: "date" } },
      fieldLabels: { dueAt: "shop:reschedule.dueAt" },
      layout: { sections: [{ fields: ["dueAt"] }] },
    };

    const { labels } = renderActionFormCapturingFieldLabels(screen);

    expect(labels["field-dueAt"]).toBe("shop:reschedule.dueAt");
  });

  test("without fieldLabels, the field renders the default __action-form__ convention label", () => {
    const screen: ActionFormScreenDefinition = {
      id: "reschedule",
      type: "actionForm",
      handler: "shop:write:reschedule",
      fields: { dueAt: { type: "date" } },
      layout: { sections: [{ fields: ["dueAt"] }] },
    };

    const { labels } = renderActionFormCapturingFieldLabels(screen);

    expect(labels["field-dueAt"]).toBe("shop:entity:__action-form__:field:dueAt");
  });
});
