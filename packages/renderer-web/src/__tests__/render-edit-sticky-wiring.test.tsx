// RenderEdit wires `stickyActions={isWizard || fillScreenHeight}`: a wizard pins its
// primary action above the mobile keyboard, a plain entityEdit (page scroll) does not.
import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import { createMockDispatcher, render, screen } from "./test-utils.js";

const entity = {
  fields: {
    name: { type: "text", required: false },
    note: { type: "text", required: false },
  },
} as unknown as EntityDefinition;

function renderScreen(layout: EntityEditScreenDefinition["layout"]): HTMLElement {
  const screenDef: EntityEditScreenDefinition = {
    id: "thing-edit",
    type: "entityEdit",
    entity: "thing",
    fillHeight: false,
    layout,
  };
  const schema: FeatureSchema = {
    featureName: "demo",
    entities: { thing: entity },
    screens: [screenDef],
  };
  render(
    <DispatcherProvider dispatcher={createMockDispatcher()}>
      <KumikoScreen schema={schema} qn="demo:screen:thing-edit" />
    </DispatcherProvider>,
  );
  return screen.getByTestId("render-edit-form-actions");
}

describe("RenderEdit stickyActions wiring", () => {
  test("wizard mode pins the primary action group on mobile", () => {
    const actions = renderScreen({
      mode: "wizard",
      sections: [
        { title: "One", fields: ["name"] },
        { title: "Two", fields: ["note"] },
      ],
    });
    expect(actions.className).toContain("max-sm:fixed");
  });

  test("default mode keeps the action group in normal flow", () => {
    const actions = renderScreen({ sections: [{ fields: ["name", "note"] }] });
    expect(actions.className).not.toContain("max-sm:fixed");
  });
});
