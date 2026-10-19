import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { fireEvent, makeDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const entity = {
  fields: {
    title: { type: "text", required: true },
    quantity: { type: "number" },
    pieces: { type: "number", required: true },
  },
} as unknown as EntityDefinition;

const editScreen: EntityEditScreenDefinition = {
  id: "item-edit",
  type: "entityEdit",
  entity: "item",
  layout: { sections: [{ title: "Basics", fields: ["title", "quantity", "pieces"] }] },
};

const schema: FeatureSchema = {
  featureName: "items",
  entities: { item: entity },
  screens: [editScreen],
};

async function clickSubmitWhenEnabled(): Promise<void> {
  await waitFor(() => {
    const button = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
  fireEvent.click(screen.getByTestId("render-edit-submit"));
}

// What the HTTP dispatcher sends: JSON drops undefined values.
function wireShape(payload: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload));
}

function inputOf(field: string): HTMLInputElement {
  return screen.getByTestId(`field-${field}`).querySelector("input") as HTMLInputElement;
}

describe("optional number fields start empty", () => {
  test("create: an untouched optional number is absent from the payload, a required one is 0", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "item-1" } };
      }) as unknown as Dispatcher["write"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="items:screen:item-edit" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(inputOf("quantity").value).toBe("");

    fireEvent.change(inputOf("title"), { target: { value: "Bolt" } });
    await clickSubmitWhenEnabled();

    await waitFor(() => expect(writeCalls.length).toBe(1));
    const payload = wireShape(writeCalls[0]?.payload);
    expect(writeCalls[0]?.type).toBe("items:write:item:create");
    expect(payload).not.toHaveProperty("quantity");
    expect(payload["pieces"]).toBe(0);
  });

  test("update: a stored null stays empty and is not sent when another field changes", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "item-1", version: 3, title: "Bolt", quantity: null, pieces: 5 },
      })) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "item-1" } };
      }) as unknown as Dispatcher["write"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="items:screen:item-edit" entityId="item-1" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(inputOf("quantity").value).toBe("");

    fireEvent.change(inputOf("title"), { target: { value: "Screw" } });
    await clickSubmitWhenEnabled();

    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(wireShape(writeCalls[0]?.payload)).toStrictEqual({
      id: "item-1",
      version: 3,
      changes: { title: "Screw" },
    });
  });
});
