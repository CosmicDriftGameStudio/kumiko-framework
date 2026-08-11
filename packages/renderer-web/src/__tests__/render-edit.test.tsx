import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher, SubmitResult } from "@cosmicdrift/kumiko-headless";
import {
  DispatcherProvider,
  DraftStorageProvider,
  ExtensionSectionsProvider,
  type ExtensionSubmitContext,
  RenderEdit,
  type RenderEditChangeState,
  type RenderEditControls,
  useExtensionFormSubmit,
} from "@cosmicdrift/kumiko-renderer";
import { useState } from "react";
import { z } from "zod";
import {
  act,
  createFakeDraftStorage,
  createMockDispatcher,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "./test-utils";

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

  // Issue #1677: a section's optional `description` renders as the
  // Section's subtitle slot underneath the block heading, and a field's
  // `icon` reaches the DOM as a prefix icon on its input.
  test("section.description renders as the section subtitle; field.icon renders a prefix icon", () => {
    const entity = {
      fields: { email: { type: "text", required: true } },
    } as unknown as EntityDefinition;
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          {
            title: "Contact",
            description: "How we'll reach you.",
            columns: 1,
            fields: [{ field: "email", icon: "mail" }],
          },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit
          screen={screenDef}
          entity={entity}
          featureName="orders"
          initial={{ email: "" } as never}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("section-Contact-subtitle").textContent).toBe("How we'll reach you.");
    const fieldEl = screen.getByTestId("field-email");
    expect(fieldEl.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(fieldEl.querySelector("input")?.className).toContain("pl-8");
  });

  // End-to-end-Routing: ein `type:"locatedTimestamp"`-Entity-Feld muss durch
  // computeEditViewModel → render-field → DefaultInput auf den Located-Picker
  // laufen (Datum + Uhrzeit + Zone), NICHT auf den Klartext-Fallthrough. Vor
  // Item 10 fehlte der `case "locatedTimestamp"` → das Feld rendrte als Text.
  test("locatedTimestamp field renders the located picker (date + time + zone), not plain text", () => {
    const entity = {
      fields: { pickup: { type: "locatedTimestamp", required: true } },
    } as unknown as EntityDefinition;
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: { sections: [{ title: "When", columns: 1, fields: ["pickup"] }] },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit
          screen={screenDef}
          entity={entity}
          featureName="orders"
          initial={
            {
              pickup: {
                at: "2026-04-03T10:00:00",
                tz: "Europe/Lisbon",
                utc: "2026-04-03T09:00:00Z",
              },
            } as never
          }
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const fieldEl = screen.getByTestId("field-pickup");
    const timeInput = fieldEl.querySelector<HTMLInputElement>('input[type="time"]');
    expect(timeInput).toBeTruthy();
    expect(timeInput?.value).toBe("10:00");
    expect(fieldEl.textContent ?? "").toMatch(/lokal|local/i);
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
    // boolean-Feld = vendored Radix-Checkbox → button[role=checkbox], kein
    // native input[type=checkbox] mehr.
    const urgentCheckbox = screen.getByTestId("field-isUrgent").querySelector('[role="checkbox"]');
    fireEvent.click(urgentCheckbox as HTMLElement);
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

  test("layout.width defaults the form shell to max-w-3xl when unset", () => {
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

    const shell = screen.getByTestId("render-edit-form").firstElementChild;
    expect(shell?.className).toContain("max-w-3xl");
    expect(shell?.className).not.toContain("max-w-full");
  });

  test("layout.width: 'full' widens the form shell to max-w-full (#1676)", () => {
    const screenDef = makeScreen();
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={{ ...screenDef, layout: { ...screenDef.layout, width: "full" } }}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const shell = screen.getByTestId("render-edit-form").firstElementChild;
    expect(shell?.className).toContain("max-w-full");
    expect(shell?.className).not.toContain("max-w-3xl");
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
    const formTitle = screen.getByTestId("render-edit-form-title");
    expect(formTitle.textContent).toContain("orders:screen:order-edit");
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

  // Issue #1888: ExtensionSectionProps.values/patch/validate pass-through —
  // same controller functions as RenderEditControls (#1887), just handed to
  // the extension section instead of onControlsReady.
  test("extension section sees current form values and its patch(...) lands in the form + outer onChange", () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          { title: "Basics", columns: 2, fields: [{ field: "title", span: 2 }, "notes"] },
          {
            kind: "extension",
            title: "VIN Decode",
            component: { react: { __component: "VinDecodeSection" } },
          },
        ],
      },
    };
    const VinDecodeSection = ({
      values,
      patch,
      validate,
    }: {
      values?: Readonly<Record<string, unknown>>;
      patch?: (partial: Readonly<Record<string, unknown>>) => void;
      validate?: () => boolean;
    }) => (
      <div data-testid="vin-decode-section">
        <span data-testid="vin-decode-sees-title">{String(values?.["title"])}</span>
        <button type="button" onClick={() => patch?.({ notes: "decoded-from-vin" })}>
          Decode
        </button>
        <button
          type="button"
          data-testid="vin-decode-validate"
          onClick={() => {
            lastValidateResult = validate?.() ?? true;
          }}
        >
          Validate
        </button>
      </div>
    );
    const seen: RenderEditChangeState<TestValues>[] = [];
    let lastValidateResult = true;
    const schema = z.object({
      title: z.string().min(1),
      count: z.number().optional(),
      isUrgent: z.boolean().optional(),
    });
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <ExtensionSectionsProvider value={{ VinDecodeSection }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0, isUrgent: false }}
            writeCommand="order:create"
            schema={schema}
            onChange={(state) => seen.push(state)}
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByTestId("vin-decode-validate"));
    });
    expect(lastValidateResult).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByTestId("field-title-errors")).toBeTruthy();

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });
    expect(screen.getByTestId("vin-decode-sees-title").textContent).toBe("Acme");

    act(() => {
      fireEvent.click(screen.getByText("Decode"));
    });

    const notesInput = screen.getByTestId("field-notes")?.querySelector("input");
    expect((notesInput as HTMLInputElement | null)?.value).toBe("decoded-from-vin");
    expect(seen.at(-1)?.values.notes).toBe("decoded-from-vin");
  });
});

describe("RenderEdit — composed extension save (Bug-Bash 3 #1)", () => {
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
          component: { react: { __component: "ComposedCF" } },
        },
      ],
    },
  };

  function renderWith(
    submitSpy: (ctx: ExtensionSubmitContext) => void,
    writeSpy: Dispatcher["write"],
  ): void {
    const ComposedCF = (_: { entityName: string; entityId: string | null }) => {
      const [touched, setTouched] = useState(false);
      useExtensionFormSubmit({
        dirty: touched,
        onSubmit: async (ctx) => {
          submitSpy(ctx);
          return { isSuccess: true as const };
        },
      });
      return (
        <button type="button" data-testid="composed-touch" onClick={() => setTouched(true)}>
          touch
        </button>
      );
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher(writeSpy)}>
        <ExtensionSectionsProvider value={{ ComposedCF }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Existing", count: 0, isUrgent: false } as TestValues}
            entityId="order-99"
            writeCommand="order:update"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );
  }

  test("Section-dirty aktiviert den Haupt-Save; CF-only-Save ruft den Handler ohne Main-Write", async () => {
    const submitSpy = mock();
    const writeSpy = mock(async () => ({
      isSuccess: true,
      data: { id: "order-99" },
    })) as unknown as Dispatcher["write"];
    renderWith(submitSpy, writeSpy);

    // Main unverändert + Section nicht dirty → Save disabled.
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(true);

    // Section dirty machen → Save enabled (composed-dirty propagiert hoch).
    act(() => {
      fireEvent.click(screen.getByTestId("composed-touch"));
    });
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(false);

    // Save → Section-Handler mit entityId; KEIN Main-Write (main unverändert).
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-submit"));
    });
    expect(submitSpy).toHaveBeenCalledWith({ entityId: "order-99" });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

// Issue #1887: controlled mode. onChange reports values out, onControlsReady
// hands the caller patch()/validate()/getValues() bound to this instance —
// all without an entity-write and without remounting RenderEdit.
describe("RenderEdit — controlled mode (#1887)", () => {
  test("onChange fires with the current values, the changes-delta, and dirty on typing", () => {
    const seen: RenderEditChangeState<TestValues>[] = [];
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
          onChange={(state) => seen.push(state)}
        />
      </DispatcherProvider>,
    );

    // Fires once on mount with the pristine snapshot.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ changes: {}, dirty: false, valid: true });

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });

    const last = seen.at(-1);
    expect(last?.values.title).toBe("Acme");
    // changes is the delta against the initial values (payloadMode: "changes"
    // semantics) — only the touched field appears, nothing else.
    expect(last?.changes).toEqual({ title: "Acme" });
    expect(last?.dirty).toBe(true);
  });

  test("onChange's valid reflects a schema dry-run and never paints field errors (banner or per-field)", () => {
    const schema = z.object({
      title: z.string().min(1),
      count: z.number().optional(),
      isUrgent: z.boolean().optional(),
    });
    const seen: RenderEditChangeState<TestValues>[] = [];
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
          schema={schema}
          onChange={(state) => seen.push(state)}
        />
      </DispatcherProvider>,
    );

    // title is required by the schema and still empty — dry-run says invalid.
    expect(seen.at(-1)?.valid).toBe(false);
    // Dry-run parse never mutates snapshot.errors — no visible field error,
    // no summary banner. Typing alone must not trigger validation display.
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
    expect(screen.queryByTestId("field-title-errors")).toBeNull();
  });

  test("a caller whose onChange calls patch() to derive a field settles instead of looping", () => {
    let calls = 0;
    let controls: RenderEditControls<TestValues> | undefined;
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
          onChange={(state) => {
            calls += 1;
            // The #1888 VIN-decode shape: a derived field is patched from
            // inside onChange itself. `count` converges to title.length, so
            // once patch() computes the same value again, setValues' no-op
            // guard (reference-equal merge) stops the chain — a caller that
            // instead patched a *fresh object reference* every time would
            // loop forever, since Object.is would never match.
            controls?.patch({ count: state.values.title.length });
          }}
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });

    // Settles at a small finite count instead of looping: mount, the typing
    // change, and the convergent patch() from inside onChange each fire
    // onChange once — more than the no-patch case (1) but bounded, not
    // unbounded.
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(10);
    expect(controls?.getValues().count).toBe("Acme".length);
  });

  test("controls.patch sets values from outside without losing edits already made in other fields", () => {
    let controls: RenderEditControls<TestValues> | undefined;
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "User-typed" } });
    expect(titleInput.value).toBe("User-typed");

    act(() => {
      controls?.patch({ count: 42 });
    });

    // count updated, title (the user's own edit) untouched.
    expect(controls?.getValues().count).toBe(42);
    expect(controls?.getValues().title).toBe("User-typed");
    expect(
      (screen.getByTestId("field-title").querySelector("input") as HTMLInputElement).value,
    ).toBe("User-typed");
  });

  test("controls.validate() reports field errors on the field, never as a summary banner, and writes nothing", () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    const schema = z.object({
      title: z.string().min(1),
      count: z.number().optional(),
      isUrgent: z.boolean().optional(),
    });
    let controls: RenderEditControls<TestValues> | undefined;
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
          schema={schema}
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    // Before validate(): no field error visible yet (mount alone never
    // validates — matches "existing behaviour unchanged" for the schema path).
    expect(screen.queryByTestId("field-title-errors")).toBeNull();

    let isValid = true;
    act(() => {
      isValid = controls?.validate() ?? true;
    });

    expect(isValid).toBe(false);
    expect(write).not.toHaveBeenCalled();
    // Field-level error, not a form-wide summary banner.
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
    expect(screen.getByTestId("field-title-errors")).toBeTruthy();
  });

  test("without onChange/onControlsReady, existing single-field-per-keystroke behaviour is unchanged", () => {
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

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });
    expect(titleInput.value).toBe("Acme");
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
  });
});

// Issue #1916: proves FieldConditions (visible/readOnly/required) react to
// values an extension section writes at runtime via patch() — not just to
// user keystrokes. Tests already merged behavior from #1887/#1888
// (controlled mode + extension-section pass-through); this is the missing
// coverage for the VIN-decode shape: a decode result reveals a different
// set of follow-up fields per car, and a field a previous decode revealed
// must fall back when a later decode clears it.
describe("RenderEdit — FieldConditions react to extension patch() (#1916)", () => {
  type VehicleValues = {
    title: string;
    vin?: string;
    trim?: string;
    decodeStatus?: string;
  };
  const vehicleEntity = {
    fields: {
      title: { type: "text", required: true },
      vin: { type: "text" },
      trim: { type: "text" },
    },
  } as unknown as EntityDefinition;

  function makeVehicleScreen(): EntityEditScreenDefinition {
    return {
      id: "vehicles:screen:vehicle-edit",
      type: "entityEdit",
      entity: "vehicle",
      layout: {
        sections: [
          {
            title: "Basics",
            columns: 2,
            fields: [
              { field: "title", span: 2 },
              // Locks once the decode confirms a match — no point letting
              // the user hand-edit a VIN the provider just validated.
              { field: "vin", readOnly: { field: "decodeStatus", eq: "hit" } },
              // A VIN hit reveals + requires the derived trim field; a car
              // whose VIN the provider can't resolve never shows it.
              {
                field: "trim",
                visible: { field: "decodeStatus", eq: "hit" },
                required: { field: "decodeStatus", eq: "hit" },
              },
            ],
          },
          {
            kind: "extension",
            title: "VIN Decode",
            component: { react: { __component: "VinDecodeSection" } },
          },
        ],
      },
    };
  }

  function VinDecodeSection({
    values,
    patch,
  }: {
    readonly values?: Readonly<Record<string, unknown>>;
    readonly patch?: (partial: Readonly<Record<string, unknown>>) => void;
  }) {
    return (
      <div data-testid="vin-decode-section">
        <span data-testid="decode-status">{String(values?.["decodeStatus"])}</span>
        <button
          type="button"
          data-testid="decode-hit"
          onClick={() => patch?.({ decodeStatus: "hit", trim: "Sport" })}
        >
          Decode (match found)
        </button>
        <button
          type="button"
          data-testid="decode-miss"
          onClick={() => patch?.({ decodeStatus: "miss" })}
        >
          Decode (no match)
        </button>
        <button
          type="button"
          data-testid="decode-clear"
          onClick={() => patch?.({ decodeStatus: undefined, trim: undefined })}
        >
          Clear decode
        </button>
      </div>
    );
  }

  function renderVehicleForm(): void {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ VinDecodeSection }}>
          <RenderEdit<VehicleValues>
            screen={makeVehicleScreen()}
            entity={vehicleEntity}
            featureName="vehicles"
            initial={{ title: "Listing", vin: "" }}
            writeCommand="vehicle:create"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );
  }

  function isRequired(testId: string): boolean {
    const label = screen.getByTestId(testId).querySelector("label");
    return (label?.textContent ?? "").includes("*");
  }

  function isDisabled(testId: string): boolean {
    return (
      (screen.getByTestId(testId).querySelector("input") as HTMLInputElement | null)?.disabled ??
      false
    );
  }

  test("provider delivers a value: the gated field becomes visible and required, the source field locks", () => {
    renderVehicleForm();
    expect(screen.queryByTestId("field-trim")).toBeNull();
    expect(isDisabled("field-vin")).toBe(false);

    act(() => {
      fireEvent.click(screen.getByTestId("decode-hit"));
    });

    expect(screen.getByTestId("decode-status").textContent).toBe("hit");
    const trimInput = screen.getByTestId("field-trim").querySelector("input") as HTMLInputElement;
    expect(trimInput.value).toBe("Sport");
    expect(isRequired("field-trim")).toBe(true);
    expect(isDisabled("field-vin")).toBe(true);
  });

  test("provider delivers nothing (patch() without a matching condition value): gated fields stay normal", () => {
    renderVehicleForm();

    act(() => {
      fireEvent.click(screen.getByTestId("decode-miss"));
    });

    // Proves the patch landed (decodeStatus really changed to "miss"),
    // ruling out a false pass from a no-op patch that never re-rendered.
    expect(screen.getByTestId("decode-status").textContent).toBe("miss");
    expect(screen.queryByTestId("field-trim")).toBeNull();
    expect(isDisabled("field-vin")).toBe(false);
  });

  test("a previously delivered value cleared by a later patch() falls the fields back", () => {
    renderVehicleForm();

    act(() => {
      fireEvent.click(screen.getByTestId("decode-hit"));
    });
    expect(screen.getByTestId("field-trim")).toBeTruthy();
    expect(isDisabled("field-vin")).toBe(true);

    act(() => {
      fireEvent.click(screen.getByTestId("decode-clear"));
    });

    expect(screen.getByTestId("decode-status").textContent).toBe("undefined");
    expect(screen.queryByTestId("field-trim")).toBeNull();
    expect(isDisabled("field-vin")).toBe(false);
  });
});

describe("RenderEdit wizard mode", () => {
  function makeWizardScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-wizard",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };
  }

  test("renders only the current step's section", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeWizardScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("field-title")).toBeTruthy();
    expect(screen.queryByTestId("field-count")).toBeNull();
    expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("1");
  });

  test("Weiter is blocked by a field validation error and does not advance the step", async () => {
    const schema = z.object({
      title: z.string().min(1),
      count: z.number().optional(),
    });
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeWizardScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
          schema={schema}
        />
      </DispatcherProvider>,
    );

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(screen.getByTestId("field-title-errors")).toBeTruthy();
    expect(screen.getByTestId("field-title")).toBeTruthy();
    expect(screen.queryByTestId("field-count")).toBeNull();
  });

  test("Weiter advances to the next step once the current step is valid; last step shows the submit button", async () => {
    const schema = z.object({
      title: z.string().min(1),
      count: z.number().optional(),
    });
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeWizardScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
          schema={schema}
        />
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("render-edit-submit")).toBeNull();

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(screen.queryByTestId("field-title")).toBeNull();
    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(screen.getByTestId("render-edit-submit")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-wizard-next")).toBeNull();
  });

  test("Zurück preserves already-entered values without validating", async () => {
    // count.min(1) with initial count=0 makes step 2 invalid on arrival —
    // if Back ran validate() it would be blocked from returning to step 1.
    const schema = z.object({
      title: z.string().min(1),
      count: z.number().min(1),
    });
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeWizardScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
          schema={schema}
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    expect(screen.getByTestId("field-count")).toBeTruthy();

    fireEvent.click(screen.getByTestId("render-edit-wizard-back"));

    const titleInputAgain = screen
      .getByTestId("field-title")
      .querySelector("input") as HTMLInputElement;
    expect(titleInputAgain.value).toBe("Acme");
    expect(screen.queryByTestId("field-title-errors")).toBeNull();
  });
});

describe("RenderEdit wizard draft", () => {
  function makeDraftWizardScreen(draft: boolean): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-wizard-draft",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        ...(draft && { draft: true }),
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };
  }

  type DraftBlob = { readonly values: Record<string, unknown>; readonly stepIndex: number };

  function isDraftSavePayload(payload: unknown): payload is DraftBlob {
    return (
      typeof payload === "object" &&
      payload !== null &&
      "values" in payload &&
      "stepIndex" in payload
    );
  }

  // In-memory fake of the bundled form-draft feature's query/write handlers —
  // proves RenderEdit round-trips through the dispatcher (real values, real
  // step), not just that it calls the right command names.
  function makeDraftDispatcher(): {
    readonly dispatcher: Dispatcher;
    readonly store: { current: DraftBlob | null };
    readonly calls: string[];
  } {
    const store: { current: DraftBlob | null } = { current: null };
    const calls: string[] = [];
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        calls.push(type);
        if (type === "form-draft:query:get") {
          return { isSuccess: true, data: { draft: store.current } };
        }
        return { isSuccess: true, data: {} };
      }) as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        calls.push(type);
        if (type === "form-draft:write:save" && isDraftSavePayload(payload)) {
          store.current = { values: payload.values, stepIndex: payload.stepIndex };
        } else if (type === "form-draft:write:discard") {
          store.current = null;
        }
        return { isSuccess: true, data: { id: "1" } };
      }) as Dispatcher["write"],
    });
    return { dispatcher, store, calls };
  }

  test("values and step survive a remount", async () => {
    const { dispatcher } = makeDraftDispatcher();
    // Simulates the browser: the same DraftStorage instance (sessionStorage
    // in production) survives the remount below, RenderEdit's in-memory
    // React state does not. Without it there's no draftId to resume from
    // and the mount would fall back to `form-draft:query:list` instead —
    // this test is specifically about the storage-resume path.
    const draftStorage = createFakeDraftStorage();

    const first = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={draftStorage}>
          <RenderEdit<TestValues>
            screen={makeDraftWizardScreen(true)}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    first.unmount();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={draftStorage}>
          <RenderEdit<TestValues>
            screen={makeDraftWizardScreen(true)}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("field-count")).toBeTruthy());
    expect(screen.queryByTestId("field-title")).toBeNull();
    expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("2");

    fireEvent.click(screen.getByTestId("render-edit-wizard-back"));
    const titleInputAgain = screen
      .getByTestId("field-title")
      .querySelector("input") as HTMLInputElement;
    expect(titleInputAgain.value).toBe("Acme");
  });

  test("a successful submit discards the draft", async () => {
    const { dispatcher, store, calls } = makeDraftDispatcher();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(true)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(store.current).not.toBeNull();

    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(store.current).toBeNull();
    expect(calls).toContain("form-draft:write:discard");
  });

  test("without layout.draft nothing hits the form-draft feature", async () => {
    const { dispatcher, calls } = makeDraftDispatcher();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(false)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(calls.some((c) => c.startsWith("form-draft:"))).toBe(false);
  });

  // Issue #1914: patch() (controlled mode / extension sections) previously
  // never triggered a draft save — only handleWizardNext/Back did. A patch()
  // on the last step (no further Next click coming) or on a step abandoned
  // without Next/Back was silently lost, forcing e.g. a repeat of a paid
  // VIN-decode round-trip on resume (#1908).
  test("controls.patch() on the last step persists into the draft blob (debounced)", async () => {
    const { dispatcher, store } = makeDraftDispatcher();
    let controls: RenderEditControls<TestValues> | undefined;

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(true)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    // Reach the last step first (handleWizardNext's own saveDraft mints the
    // draftId) — the bug is specifically about a patch() AFTER that, with no
    // further Next/Back to piggyback a save on.
    fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
    expect(screen.getByTestId("field-count")).toBeTruthy();

    act(() => {
      controls?.patch({ count: 7 });
    });

    await waitFor(
      () => {
        const values = store.current?.values as { count?: number } | undefined;
        expect(values?.count).toBe(7);
      },
      { timeout: 3000 },
    );
  });

  test("remount after patch() without a Next/Back click shows the patched value", async () => {
    const { dispatcher, store } = makeDraftDispatcher();
    const draftStorage = createFakeDraftStorage();
    let controls: RenderEditControls<TestValues> | undefined;

    const first = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={draftStorage}>
          <RenderEdit<TestValues>
            screen={makeDraftWizardScreen(true)}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
            onControlsReady={(c) => {
              controls = c;
            }}
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    // No Next/Back click anywhere in this test — patch() alone, on the
    // first step, must still mint a draftId and persist (proves there is
    // no second, blob-bypassing write path for patch()'d data either: this
    // writes exclusively via patch(), the remount below reads exclusively
    // via form-draft:query:get).
    act(() => {
      controls?.patch({ title: "Patched" });
    });

    await waitFor(() => expect(store.current).not.toBeNull(), { timeout: 3000 });

    first.unmount();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={draftStorage}>
          <RenderEdit<TestValues>
            screen={makeDraftWizardScreen(true)}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(
      () => {
        const titleInput = screen
          .getByTestId("field-title")
          .querySelector("input") as HTMLInputElement;
        expect(titleInput.value).toBe("Patched");
      },
      { timeout: 3000 },
    );
  });

  test("a burst of patch() calls collapses into a single debounced draft save", async () => {
    const { dispatcher, calls } = makeDraftDispatcher();
    let controls: RenderEditControls<TestValues> | undefined;

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(true)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    const savesSoFar = () => calls.filter((c) => c === "form-draft:write:save").length;
    const before = savesSoFar();

    // Each patch() resets the same debounce timer — three patches in one
    // burst must still land as exactly one form-draft:write:save, not three.
    act(() => {
      controls?.patch({ count: 1 });
      controls?.patch({ count: 2 });
      controls?.patch({ count: 3 });
    });

    await waitFor(() => expect(savesSoFar()).toBe(before + 1), { timeout: 3000 });
    expect(savesSoFar()).toBe(before + 1);
  });
});

describe("RenderEdit create-mode draftId (issue #1913)", () => {
  function makeDraftWizardScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-wizard-draftid",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        draft: true,
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };
  }

  type DraftBlob = { readonly values: Record<string, unknown>; readonly stepIndex: number };
  type StoredDraft = DraftBlob & { readonly savedAt: string };

  // Per-draftKey fake (unlike the single-slot `makeDraftDispatcher` above) —
  // needed to prove two parallel create sessions land on two distinct rows,
  // and to back the `form-draft:query:list` fallback (multiple candidates,
  // picker, adopt).
  function makeMultiDraftDispatcher(): {
    readonly dispatcher: Dispatcher;
    readonly drafts: Map<string, StoredDraft>;
  } {
    const drafts = new Map<string, StoredDraft>();
    let seq = 0;
    const dispatcher = createMockDispatcher({
      query: (async (type: string, payload: unknown) => {
        if (type === "form-draft:query:get") {
          const { draftKey } = payload as { draftKey: string };
          return { isSuccess: true, data: { draft: drafts.get(draftKey) ?? null } };
        }
        if (type === "form-draft:query:list") {
          const { screenId } = payload as { screenId: string };
          const prefix = `${screenId}:`;
          const matches = [...drafts.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, draft]) => ({
              id: key,
              draftKey: key,
              stepIndex: draft.stepIndex,
              savedAt: draft.savedAt,
            }));
          return { isSuccess: true, data: { drafts: matches } };
        }
        return { isSuccess: true, data: {} };
      }) as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        if (type === "form-draft:write:save") {
          const { draftKey, values, stepIndex } = payload as {
            draftKey: string;
            values: Record<string, unknown>;
            stepIndex: number;
          };
          seq += 1;
          drafts.set(draftKey, {
            values,
            stepIndex,
            savedAt: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
          });
        } else if (type === "form-draft:write:discard") {
          const { draftKey } = payload as { draftKey: string };
          drafts.delete(draftKey);
        }
        return { isSuccess: true, data: { id: "1" } };
      }) as Dispatcher["write"],
    });
    return { dispatcher, drafts };
  }

  test("two parallel create sessions on the same screen get different draftKeys and don't overwrite each other (#1908)", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();

    const sessionA = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );
    const sessionB = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    const titleA = within(sessionA.container)
      .getByTestId("field-title")
      .querySelector("input") as HTMLInputElement;
    fireEvent.change(titleA, { target: { value: "Session A" } });
    await act(async () => {
      fireEvent.submit(within(sessionA.container).getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    const titleB = within(sessionB.container)
      .getByTestId("field-title")
      .querySelector("input") as HTMLInputElement;
    fireEvent.change(titleB, { target: { value: "Session B" } });
    await act(async () => {
      fireEvent.submit(within(sessionB.container).getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    const prefix = `${screenDef.id}:new:`;
    const createDraftKeys = [...drafts.keys()].filter((k) => k.startsWith(prefix));
    expect(createDraftKeys).toHaveLength(2);
    const [keyA, keyB] = createDraftKeys as [string, string];
    expect(keyA).not.toBe(keyB);
    const titles = createDraftKeys.map((k) => drafts.get(k)?.values["title"]).sort();
    expect(titles).toEqual(["Session A", "Session B"]);
  });

  test("cleared storage with exactly one open draft resumes it automatically via list", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    // Pre-seed one existing create-mode draft, as if minted by an earlier,
    // now-storage-less session (new tab / cleared sessionStorage).
    drafts.set(`${screenDef.id}:new:existing-id`, {
      values: { title: "Resumed", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-01T00:00:00Z",
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => {
      const titleInput = screen
        .getByTestId("field-title")
        .querySelector("input") as HTMLInputElement;
      expect(titleInput.value).toBe("Resumed");
    });
    expect(screen.queryByTestId("render-edit-draft-picker")).toBeNull();
  });

  test("cleared storage with multiple open drafts shows a picker; picking one resumes it", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    drafts.set(`${screenDef.id}:new:draft-1`, {
      values: { title: "First draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-01T00:00:00Z",
    });
    drafts.set(`${screenDef.id}:new:draft-2`, {
      values: { title: "Second draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-02T00:00:00Z",
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-draft-picker")).toBeTruthy());
    const pickSecond = screen.getByTestId(`render-edit-draft-pick-${screenDef.id}:new:draft-2`);
    fireEvent.click(pickSecond);

    await waitFor(() => {
      const titleInput = screen
        .getByTestId("field-title")
        .querySelector("input") as HTMLInputElement;
      expect(titleInput.value).toBe("Second draft");
    });
    expect(screen.queryByTestId("render-edit-draft-picker")).toBeNull();
  });

  test("minting a draftId clears a stale picker — a candidate can't hijack the just-minted key", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    drafts.set(`${screenDef.id}:new:draft-1`, {
      values: { title: "First draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-01T00:00:00Z",
    });
    drafts.set(`${screenDef.id}:new:draft-2`, {
      values: { title: "Second draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-02T00:00:00Z",
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-draft-picker")).toBeTruthy());

    // The user ignores the picker and starts a genuinely new record instead.
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Fresh session" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });

    // The stale picker must not survive the mint — picking draft-1/draft-2
    // afterwards would repoint draftKey at an unrelated draft mid-edit.
    expect(screen.queryByTestId("render-edit-draft-picker")).toBeNull();

    const prefix = `${screenDef.id}:new:`;
    const mintedKeys = [...drafts.keys()].filter(
      (k) => k.startsWith(prefix) && k !== `${prefix}draft-1` && k !== `${prefix}draft-2`,
    );
    expect(mintedKeys).toHaveLength(1);
    const [mintedKey] = mintedKeys as [string];
    expect(drafts.get(mintedKey)?.values["title"]).toBe("Fresh session");
    // The two pre-existing candidates are untouched by the fresh mint.
    expect(drafts.get(`${prefix}draft-1`)?.values["title"]).toBe("First draft");
    expect(drafts.get(`${prefix}draft-2`)?.values["title"]).toBe("Second draft");
  });

  test("discarding a draft doesn't re-arm the list fallback and silently adopt a parallel draft", async () => {
    const { dispatcher: baseDispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    // A parallel create session on the same screen, still open.
    drafts.set(`${screenDef.id}:new:other-session`, {
      values: { title: "Someone else's draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-01T00:00:00Z",
    });

    // Counts `form-draft:query:list` calls directly — the mechanism under
    // test (didListRef) gates exactly this call, so this is a more precise
    // signal than any DOM side effect of a (possibly delayed) re-adopt.
    let listCallCount = 0;
    const dispatcher: Dispatcher = {
      ...baseDispatcher,
      query: (async (type: string, payload: unknown) => {
        if (type === "form-draft:query:list") listCallCount += 1;
        return (baseDispatcher.query as (t: string, p: unknown) => Promise<unknown>)(type, payload);
      }) as Dispatcher["query"],
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    // The lone open draft (`other-session`) auto-adopts on mount — the same
    // path a cleared-storage tab takes. Wait for that to settle first.
    await waitFor(() => {
      const titleInput = screen
        .getByTestId("field-title")
        .querySelector("input") as HTMLInputElement;
      expect(titleInput.value).toBe("Someone else's draft");
    });
    expect(listCallCount).toBe(1);

    // The user overwrites the adopted draft with their own new record,
    // steps through the wizard, and submits on the last step — a real
    // submit (not just a draft-save Next), which discards the (now
    // theirs) draftId.
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "My own record" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });
    const countInput = screen.getByTestId("field-count").querySelector("input") as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: "5" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-submit"));
      await Promise.resolve();
    });

    expect(drafts.has(`${screenDef.id}:new:other-session`)).toBe(false);

    // A second parallel draft appears on the same screen right after submit
    // (e.g. another tab). The just-discarded instance's draftId reset to
    // null must not re-run the list fallback and silently repopulate the
    // form with it — a re-arm would auto-adopt it, jump the wizard back to
    // its saved step (0) and overwrite the just-submitted values, which
    // would put step 0's "field-title" section back on screen.
    drafts.set(`${screenDef.id}:new:yet-another-session`, {
      values: { title: "A completely different draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-03T00:00:00Z",
    });
    // Flush thoroughly (not just one microtask tick) — a re-armed effect's
    // full chain (query → filter → setDraftId → re-render → GET restore →
    // setValues) needs several turns to complete, and this assertion must
    // hold even after every one of them ran.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(listCallCount).toBe(1);
    expect(screen.queryByTestId("field-title")).toBeNull();
    expect(screen.queryByTestId("render-edit-draft-picker")).toBeNull();
    const countAfterSubmit = screen
      .getByTestId("field-count")
      .querySelector("input") as HTMLInputElement;
    expect(countAfterSubmit.value).toBe("5");
  });

  test("edit-mode draftKey stays screenId:entityId — unaffected by create-mode draftId minting", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Existing", count: 5 }}
            entityId="order-77"
            writeCommand="order:update"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Existing edited" } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    expect([...drafts.keys()]).toEqual([`${screenDef.id}:order-77`]);
  });
});

describe("RenderEdit locked state (#1896)", () => {
  test("disabled renders every field inactive and the submit button inactive", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
          disabled
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input");
    expect((titleInput as HTMLInputElement).disabled).toBe(true);
    const countInput = screen.getByTestId("field-count").querySelector("input");
    expect((countInput as HTMLInputElement).disabled).toBe(true);
    const urgentCheckbox = screen.getByTestId("field-isUrgent").querySelector('[role="checkbox"]');
    expect((urgentCheckbox as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  test("disabled blocks the write even on a direct form submit (Enter key), not just via the button", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
          disabled
        />
      </DispatcherProvider>,
    );

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(write).not.toHaveBeenCalled();
  });

  test("without disabled, fields and submit stay active (existing behaviour unchanged)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input");
    expect((titleInput as HTMLInputElement).disabled).toBe(false);
  });
});

describe("RenderEdit fields filter", () => {
  const filterEntity = {
    fields: {
      title: { type: "text", required: true },
      count: { type: "number" },
      notes: { type: "text" },
    },
  } as unknown as EntityDefinition;

  function makeTwoSectionScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-edit-filter",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          { title: "Basics", columns: 1, fields: ["title"] },
          { title: "Extra", columns: 2, fields: ["count", "notes"] },
        ],
      },
    };
  }

  type FilterValues = { title: string; count?: number; notes?: string };

  test("fields prop renders only the listed fields; others are absent from the DOM", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<FilterValues>
          screen={makeTwoSectionScreen()}
          entity={filterEntity}
          featureName="orders"
          initial={{ title: "", count: 0, notes: "" }}
          writeCommand="order:create"
          fields={["title"]}
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("field-title")).toBeTruthy();
    expect(screen.queryByTestId("field-count")).toBeNull();
    expect(screen.queryByTestId("field-notes")).toBeNull();
  });

  test("a section with no fields left after filtering renders no section container at all", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<FilterValues>
          screen={makeTwoSectionScreen()}
          entity={filterEntity}
          featureName="orders"
          initial={{ title: "", count: 0, notes: "" }}
          writeCommand="order:create"
          fields={["title"]}
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("section-Basics")).toBeTruthy();
    expect(screen.queryByTestId("section-Extra")).toBeNull();
  });

  test("a schema-required field outside `fields` does not block submit", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    const schema = z.object({
      title: z.string().min(1),
      notes: z.string().min(1),
    });

    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<FilterValues>
          screen={makeTwoSectionScreen()}
          entity={filterEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, notes: "" }}
          writeCommand="order:create"
          schema={schema}
          fields={["title"]}
        />
      </DispatcherProvider>,
    );

    // `notes` is required by the schema and empty, but it's filtered out of
    // the rendered form — the user has no way to fix it, so it must not
    // block the submit.
    expect(screen.queryByTestId("field-notes")).toBeNull();

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
  });

  test("a schema-required field inside `fields` still blocks submit", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    const schema = z.object({
      title: z.string().min(1),
      notes: z.string().min(1),
    });

    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<FilterValues>
          screen={makeTwoSectionScreen()}
          entity={filterEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, notes: "" }}
          writeCommand="order:create"
          schema={schema}
          fields={["title", "notes"]}
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("field-notes")).toBeTruthy();

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(write).not.toHaveBeenCalled();
    expect(screen.getByTestId("field-notes-errors")).toBeTruthy();
  });
});
