// EditFieldSpec.badge (fixed label or text from a value field) and hintField on a record page.
import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, render, screen } from "./test-utils.tsx";

const record = { id: "r1", mileage: "", mileageBadge: "Field missing", mileageSource: "From chat" };

function renderScreen(
  field: Record<string, unknown>,
  data: Record<string, unknown> = record,
): void {
  const query = (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["query"];
  const definition = {
    id: "file",
    type: "projectionDetail",
    query: "shop:query:file",
    valueDisplay: "text",
    layout: { sections: [{ title: "Data", columns: 2, fields: [{ field: "mileage", ...field }] }] },
  } as ProjectionDetailScreenDefinition;
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
      <KumikoScreen
        schema={{ featureName: "shop", entities: {}, screens: [definition] }}
        qn="shop:screen:file"
        entityId="r1"
      />
    </DispatcherProvider>,
  );
}

describe("field badge and hint", () => {
  test("a badge fed by a value field shows its text next to the label", async () => {
    renderScreen({ badge: { field: "mileageBadge", tone: "warn" } });
    const badge = await screen.findByTestId("field-badge-mileage");
    expect(badge.textContent).toContain("Field missing");
  });

  test("an empty badge text draws no pill", async () => {
    renderScreen(
      { badge: { field: "mileageBadge", tone: "warn" } },
      { ...record, mileageBadge: "" },
    );
    await screen.findByText("Data");
    expect(screen.queryByTestId("field-badge-mileage")).toBeNull();
  });

  test("hintField shows the text under the field", async () => {
    renderScreen({ hintField: "mileageSource" });
    expect(await screen.findByText("From chat")).not.toBeNull();
  });
});
