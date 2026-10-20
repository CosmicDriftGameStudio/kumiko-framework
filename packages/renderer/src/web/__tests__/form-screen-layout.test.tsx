import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { FormScreenLayout } from "../../components/form-screen-layout.tsx";
import {
  DispatcherProvider,
  type FeatureSchema,
  KumikoScreen,
  usePrimitives,
} from "../../index.ts";
import { createMockDispatcher, render, screen } from "./test-utils.tsx";

function UploadSections() {
  const { Section, Button } = usePrimitives();
  return (
    <FormScreenLayout
      testId="fsl"
      description="Belege und Rechnungen hochladen"
      actions={<Button testId="to-review">Zur Prüfung</Button>}
    >
      <Section title="Dateien" icon="upload" subtitle="PDF oder Foto je Beleg" testId="sec">
        <span>zone</span>
      </Section>
    </FormScreenLayout>
  );
}

const entity = {
  fields: { name: { type: "text", required: false } },
} as unknown as EntityDefinition;

function renderEntityEdit(): void {
  const screenDef: EntityEditScreenDefinition = {
    id: "thing-edit",
    type: "entityEdit",
    entity: "thing",
    layout: { sections: [{ fields: ["name"] }] },
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
}

const columnOf = (scroll: HTMLElement): Element | null =>
  scroll.firstElementChild?.firstElementChild ?? null;

describe("FormScreenLayout", () => {
  test("renders section title, icon and description, the form subtitle and pinned footer actions", () => {
    render(<UploadSections />);
    expect(screen.getByTestId("sec-title").textContent).toContain("Dateien");
    expect(screen.getByTestId("sec-title").querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("sec-subtitle").textContent).toBe("PDF oder Foto je Beleg");
    expect(screen.getByText("Belege und Rechnungen hochladen")).toBeDefined();
    expect(screen.getByTestId("fsl-actions").contains(screen.getByTestId("to-review"))).toBe(true);
    expect(screen.getByTestId("fsl-scroll").contains(screen.getByTestId("fsl-actions"))).toBe(
      false,
    );
  });

  test("has the same scroll surface and left-aligned column as an entityEdit screen form", () => {
    const { unmount } = render(<UploadSections />);
    const custom = columnOf(screen.getByTestId("fsl-scroll"));
    const customScrollClass = screen.getByTestId("fsl-scroll").className;
    unmount();
    renderEntityEdit();
    const standard = columnOf(screen.getByTestId("render-edit-form-scroll"));
    expect(custom).not.toBeNull();
    expect(custom?.className).toBe(standard?.className);
    expect(custom?.className).toContain("max-w-[640px]");
    expect(custom?.className).not.toContain("mx-auto");
    expect(customScrollClass).toBe(screen.getByTestId("render-edit-form-scroll").className);
  });
});
