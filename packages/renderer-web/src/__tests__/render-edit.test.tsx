import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher, SubmitResult } from "@cosmicdrift/kumiko-headless";
import {
  DispatcherProvider,
  ExtensionSectionsProvider,
  type ExtensionSubmitContext,
  RenderEdit,
  type RenderEditChangeState,
  type RenderEditControls,
  useExtensionFormSubmit,
} from "@cosmicdrift/kumiko-renderer";
import { useState } from "react";
import { z } from "zod";
import { act, createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils";

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

    const first = render(
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

    first.unmount();

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
