import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher, SubmitResult } from "@cosmicdrift/kumiko-headless";
import {
  DispatcherProvider,
  ExtensionSectionsProvider,
  RenderEdit,
} from "@cosmicdrift/kumiko-renderer";
import { act, createMockDispatcher, fireEvent, render, screen } from "./test-utils";

const orderEntity = {
  fields: {
    title: { type: "text", required: true },
    count: { type: "number" },
    isUrgent: { type: "boolean" },
    notes: { type: "text" },
  },
} as unknown as EntityDefinition;

function makeScreen(): EntityEditScreenDefinition {
  return {
    id: "orders:screen:order-edit",
    type: "entityEdit",
    entity: "order",
    layout: {
      sections: [
        {
          title: "Basics",
          columns: 2,
          fields: [
            { field: "title", span: 2 },
            "count",
            "isUrgent",
            {
              field: "notes",
              visible: { field: "isUrgent", eq: true },
              required: { field: "isUrgent", eq: true },
            },
          ],
        },
      ],
    },
  };
}

function makeDispatcher(writeFn?: Dispatcher["write"]): Dispatcher {
  return createMockDispatcher({
    write:
      writeFn ?? ((async () => ({ isSuccess: true, data: { id: "1" } })) as Dispatcher["write"]),
  });
}

type TestValues = {
  title: string;
  count?: number;
  isUrgent?: boolean;
  notes?: string;
};

describe("RenderEdit", () => {
  test("renders a field per visible section entry with its resolved label", () => {
    const dispatcher = makeDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    // Visible: title, count, isUrgent. notes hidden because isUrgent=false.
    expect(screen.getByTestId("field-title")).toBeTruthy();
    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(screen.getByTestId("field-isUrgent")).toBeTruthy();
    expect(screen.queryByTestId("field-notes")).toBeNull();
  });

  test("typing in an input updates the form snapshot (controller + view-model round-trip)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input");
    expect(titleInput).toBeTruthy();
    fireEvent.change(titleInput as HTMLInputElement, { target: { value: "Acme" } });
    expect((titleInput as HTMLInputElement).value).toBe("Acme");
  });

  test("toggling isUrgent reveals the notes field (conditional predicate re-evaluates)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("field-notes")).toBeNull();
    const urgentCheckbox = screen
      .getByTestId("field-isUrgent")
      .querySelector("input[type=checkbox]");
    fireEvent.click(urgentCheckbox as HTMLInputElement);
    expect(screen.queryByTestId("field-notes")).toBeTruthy();
  });

  test("submit fires dispatcher.write with the current values; onSubmit receives the result", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "42" } }) as never);
    const dispatcher = makeDispatcher(write);
    const seenResults: SubmitResult<unknown>[] = [];

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
          onSubmit={(r) => seenResults.push(r)}
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Hello" } });

    const form = screen.getByTestId("render-edit-form");
    // `act` so the async state update React does after submit resolves
    // (flipping isDirty back to false after rebase) is flushed before
    // the assertions run.
    await act(async () => {
      fireEvent.submit(form);
      // microtask boundary for the handleSubmit promise chain
      await Promise.resolve();
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("order:create", expect.anything());
    expect(seenResults).toHaveLength(1);
    expect(seenResults[0]?.isSuccess).toBe(true);
  });

  test("title resolved aus i18n-Key `screen:<id>.title` mit screenId als Fallback", () => {
    const dispatcher = makeDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );
    // Default-Translate (Test-Setup hat keinen Bundle für screen:*.title)
    // → i18n returnt den Key selber, RenderEdit detected das + zeigt
    // den screenId. Beweist die Convention: kein Hardcoded "Untitled".
    const actionsBar = screen.getByTestId("render-edit-form-actions");
    expect(actionsBar.textContent).toContain("orders:screen:order-edit");
  });

  test("extension section renders the registered Component with entityName + entityId", () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          {
            title: "Basics",
            columns: 2,
            fields: [{ field: "title", span: 2 }],
          },
          {
            kind: "extension",
            title: "Custom Fields",
            component: { react: { __component: "MyCustomFieldsForm" } },
          },
        ],
      },
    };
    const MyCustomFieldsForm = ({
      entityName,
      entityId,
    }: {
      entityName: string;
      entityId: string | null;
    }) => (
      <div data-testid="my-custom-fields-form">
        {entityName}:{entityId ?? "(create)"}
      </div>
    );
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ MyCustomFieldsForm }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0, isUrgent: false, id: "row-42" } as TestValues}
            writeCommand="order:update"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("section-extension-Custom Fields")).toBeTruthy();
    const mounted = screen.getByTestId("my-custom-fields-form");
    expect(mounted.textContent).toBe("order:row-42");
  });

  // Realer Update-Flow: EntityEditUpdateForm lässt `id` BEWUSST aus den
  // Form-values (id ist keine deklarierte Field) und reicht die route-id
  // stattdessen über die entityId-prop durch. Ohne den entityId-prop-Pfad
  // fiele die Section auf vm.id (=values["id"]=undefined) zurück → create-
  // mode trotz Edit (der Set-Value-UI-Bug, #187..fix).
  test("extension section uses the entityId prop when id is absent from form values", () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          { title: "Basics", columns: 2, fields: [{ field: "title", span: 2 }] },
          {
            kind: "extension",
            title: "Custom Fields",
            component: { react: { __component: "MyCustomFieldsForm" } },
          },
        ],
      },
    };
    const MyCustomFieldsForm = ({
      entityName,
      entityId,
    }: {
      entityName: string;
      entityId: string | null;
    }) => (
      <div data-testid="my-custom-fields-form">
        {entityName}:{entityId ?? "(create)"}
      </div>
    );
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ MyCustomFieldsForm }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            // KEIN id in den values (wie der echte Update-Form), aber
            // entityId-prop trägt die route-id.
            initial={{ title: "Existing", count: 0, isUrgent: false } as TestValues}
            entityId="order-99"
            writeCommand="order:update"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const mounted = screen.getByTestId("my-custom-fields-form");
    expect(mounted.textContent).toBe("order:order-99");
  });

  test("extension section without registered component shows the placeholder banner", () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          {
            title: "Basics",
            columns: 1,
            fields: [{ field: "title", span: 1 }],
          },
          {
            kind: "extension",
            title: "Custom Fields",
            component: { react: { __component: "UnregisteredComp" } },
          },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{}}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0, isUrgent: false }}
            writeCommand="order:create"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const placeholder = screen.getByTestId("section-extension-placeholder-Custom Fields");
    expect(placeholder.textContent).toContain("UnregisteredComp");
  });
});
