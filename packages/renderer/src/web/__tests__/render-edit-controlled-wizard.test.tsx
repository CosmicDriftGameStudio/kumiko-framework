import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useState } from "react";
import * as z from "zod";
import type { Dispatcher } from "../../headless/index.ts";
import {
  DispatcherProvider,
  ExtensionSectionsProvider,
  RenderEdit,
  type RenderEditChangeState,
  type RenderEditControls,
  useExtensionFormSubmit,
} from "../../index.ts";
import {
  makeDispatcher,
  makeScreen,
  orderEntity,
  type TestValues,
} from "./_render-edit-helpers.tsx";
import { act, fireEvent, render, screen } from "./test-utils.tsx";

// Controlled mode. onChange reports values out, onControlsReady
// hands the caller patch()/validate()/getValues() bound to this instance —
// all without an entity-write and without remounting RenderEdit.
function Host(): ReactNode {
  const [ready, setReady] = useState(false);
  const [received, setReceived] = useState<RenderEditControls<TestValues> | undefined>(undefined);
  // Stable identity across renders, like a real caller's useCallback:
  // an inline arrow here would change on every render and defeat the
  // re-delivery guard's identity check, looping the effect.
  const onControlsReady = useCallback((c: RenderEditControls<TestValues>) => {
    setReceived(c);
  }, []);
  return (
    <>
      <button type="button" data-testid="make-ready" onClick={() => setReady(true)}>
        ready
      </button>
      <div data-testid="received">{received !== undefined ? "yes" : "no"}</div>
      <RenderEdit<TestValues>
        screen={makeScreen()}
        entity={orderEntity}
        featureName="orders"
        initial={{ title: "", count: 0, isUrgent: false }}
        writeCommand="order:create"
        {...(ready && { onControlsReady })}
      />
    </>
  );
}

describe("RenderEdit — controlled mode", () => {
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

  test("onChange's valid ignores schema issues on hidden fields", () => {
    // notes is required by the schema but hidden while isUrgent is false.
    const schema = z.object({ title: z.string(), notes: z.string().min(1) });
    const seen: RenderEditChangeState<TestValues>[] = [];
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Order", count: 0, isUrgent: false }}
          writeCommand="order:create"
          schema={schema}
          onChange={(state) => seen.push(state)}
        />
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("field-notes")).toBeNull();
    expect(seen.at(-1)?.valid).toBe(true);
  });

  test("onChange's valid ignores schema issues outside the `fields` scope", () => {
    const schema = z.object({ title: z.string(), count: z.number().min(5) });
    const seen: RenderEditChangeState<TestValues>[] = [];
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Order", count: 0, isUrgent: false }}
          writeCommand="order:create"
          fields={["title"]}
          schema={schema}
          onChange={(state) => seen.push(state)}
        />
      </DispatcherProvider>,
    );

    expect(seen.at(-1)?.valid).toBe(true);
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
            // The VIN-decode shape: a derived field is patched from
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

  test("onControlsReady fires before the mount-time onChange call", () => {
    // A prefilled `initial` derives a dependent field on mount via
    // controls.patch() from inside onChange — this only works if controls
    // are already handed out by the time onChange fires for the first time.
    let mountTimeControlsWereDefined = false;
    let onChangeCalls = 0;
    let controls: RenderEditControls<TestValues> | undefined;
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, isUrgent: false }}
          writeCommand="order:create"
          onChange={(state) => {
            onChangeCalls += 1;
            if (onChangeCalls === 1) {
              mountTimeControlsWereDefined = controls !== undefined;
              controls?.patch({ count: state.values.title.length });
            }
          }}
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    expect(mountTimeControlsWereDefined).toBe(true);
    expect(controls?.getValues().count).toBe("Acme".length);
  });

  // A caller that supplies onControlsReady only after this mount
  // (e.g. `onControlsReady={ready ? handler : undefined}`) must still get
  // delivered to for THIS mount — the effect's deps previously excluded
  // onControlsReady itself, so it never re-ran once mounted without it.
  test("onControlsReady delivers to a handler supplied after mount, not just at mount time", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <Host />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("received").textContent).toBe("no");

    act(() => {
      fireEvent.click(screen.getByTestId("make-ready"));
    });

    expect(screen.getByTestId("received").textContent).toBe("yes");
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

  // A caller like `schema={z.object({...})}` builds a fresh schema object on
  // every render — unstable identity. If the effect depended on `schema`
  // directly (not a ref), a parent that re-renders on every onChange call
  // would refire the effect every time even though nothing in the form
  // actually changed, risking an infinite update loop.
  test("a parent re-rendering with a fresh schema object on every onChange does not loop", () => {
    let calls = 0;
    // biome-ignore lint/correctness/noComponentHookFactories: closes over the test-local calls counter; defined once per test run, never during a render
    function Wrapper() {
      const [, setTick] = useState(0);
      const schema = z.object({ title: z.string().min(1) });
      return (
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
          schema={schema}
          onChange={() => {
            calls += 1;
            // Cap so a still-broken implementation fails fast on a bounded
            // count instead of hanging the test runner in an update loop.
            if (calls < 15) setTick((t) => t + 1);
          }}
        />
      );
    }

    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <Wrapper />
      </DispatcherProvider>,
    );

    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThan(5);
  });
});

// Proves FieldConditions (visible/readOnly/required) react to
// values an extension section writes at runtime via patch() — not just to
// user keystrokes. Tests already merged behavior from controlled mode
// (controlled mode + extension-section pass-through); this is the missing
// coverage for the VIN-decode shape: a decode result reveals a different
// set of follow-up fields per car, and a field a previous decode revealed
// must fall back when a later decode clears it.
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

describe("RenderEdit — FieldConditions react to extension patch()", () => {
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

  function renderVehicleForm(writeFn?: Dispatcher["write"], schema?: z.ZodType): void {
    render(
      <DispatcherProvider dispatcher={makeDispatcher(writeFn)}>
        <ExtensionSectionsProvider value={{ VinDecodeSection }}>
          <RenderEdit<VehicleValues>
            screen={makeVehicleScreen()}
            entity={vehicleEntity}
            featureName="vehicles"
            initial={{ title: "Listing", vin: "" }}
            writeCommand="vehicle:create"
            {...(schema !== undefined && { schema })}
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );
  }

  function isRequired(testId: string): boolean {
    return screen.getByTestId(testId).querySelector("[aria-required='true']") !== null;
  }

  function isDisabled(testId: string): boolean {
    const input = screen.getByTestId(testId).querySelector("input");
    if (!input) throw new Error(`${testId} has no input`);
    return (input as HTMLInputElement).disabled;
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

  // The required condition must reach the validation record, not just
  // the rendered asterisk — a regression where the extension patch() lands
  // in the render model but not the values the schema validates against
  // would stay green without this: the field would look required but submit
  // would go through anyway. Mirrors buildFormSchema's conditional-required
  // shape (form-schema.ts) with an inline schema, same as the other
  // RenderEdit tests in this file — RenderEdit itself takes `schema` as a
  // prop and does not derive one from the layout on its own.
  test("clearing trim after a decode-hit blocks submit — the required condition is enforced, not just displayed", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    const schema = z
      .object({ title: z.string().min(1) })
      .passthrough()
      .superRefine((values, ctx) => {
        const v = values as { decodeStatus?: string; trim?: string };
        if (v.decodeStatus === "hit" && (v.trim === undefined || v.trim === "")) {
          ctx.addIssue({ code: "custom", path: ["trim"], message: '"trim" is required.' });
        }
      });
    renderVehicleForm(write as unknown as Dispatcher["write"], schema);

    act(() => {
      fireEvent.click(screen.getByTestId("decode-hit"));
    });
    const trimInput = screen.getByTestId("field-trim").querySelector("input") as HTMLInputElement;
    expect(isRequired("field-trim")).toBe(true);

    fireEvent.change(trimInput, { target: { value: "" } });

    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    expect(write).not.toHaveBeenCalled();
    expect(screen.getByTestId("field-trim-errors")).toBeTruthy();
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

  test("wizard pins the primary action and pads the content; a plain edit screen does not", () => {
    const { unmount } = render(
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
    const wizardActions = screen.getByTestId("render-edit-form-actions");
    expect(wizardActions.className).toContain("max-sm:fixed");
    const wizardContent = (wizardActions.parentElement as HTMLElement)
      .previousElementSibling as HTMLElement;
    expect(wizardContent.className).toContain("max-sm:pb-[calc(6rem");
    unmount();

    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );
    const plainActions = screen.getByTestId("render-edit-form-actions");
    expect(plainActions.className).not.toContain("max-sm:fixed");
    const plainContent = (plainActions.parentElement as HTMLElement)
      .previousElementSibling as HTMLElement;
    expect(plainContent.className).not.toContain("max-sm:pb-[calc(6rem");
  });

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
    expect(screen.getByTestId("field-count").closest("[hidden]")).not.toBeNull();
    expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("1");
  });

  test("a hideActions host steps with controls.next()/back() and controls.submit() saves on an intermediate step", async () => {
    const writes: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher((async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: { id: "1" } };
    }) as Dispatcher["write"]);
    let controls: RenderEditControls<TestValues> | undefined;
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeWizardScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0 }}
          writeCommand="order:create"
          hideActions
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );
    const stepLabel = () => screen.getByTestId("render-edit-wizard-step-label").textContent;

    await act(async () => {
      controls?.next();
    });
    expect(stepLabel()).toContain("2");
    await act(async () => {
      controls?.back();
    });
    expect(stepLabel()).toContain("1");

    await act(async () => {
      await controls?.submit();
    });
    expect(writes).toHaveLength(1);
    expect(stepLabel()).toContain("1");
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
    expect(screen.getByTestId("field-count").closest("[hidden]")).not.toBeNull();
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

    expect(screen.getByTestId("field-title").closest("[hidden]")).not.toBeNull();
    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(screen.getByTestId("render-edit-submit")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-wizard-next")).toBeNull();
  });

  test("Back preserves already-entered values without validating", async () => {
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

  // Regression for form-controller.ts's `hiddenFields` guard: a required
  // field currently hidden by its own condition (e.g. vatId when not a
  // company) must not block wizard "Next". This is independent of any
  // handleWizardNext fieldNames narrowing — those paths are covered by
  // the fully-hidden-section test below.
  test("Weiter is not blocked by a required field that's currently hidden by its own condition", async () => {
    const companyEntity = {
      fields: {
        isCompany: { type: "boolean" },
        vatId: { type: "text", required: true },
        count: { type: "number" },
      },
    } as unknown as EntityDefinition;
    const wizardScreen: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard-conditional",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        sections: [
          {
            title: "Basics",
            columns: 1,
            fields: [
              "isCompany",
              {
                field: "vatId",
                visible: { field: "isCompany", eq: true },
                required: { field: "isCompany", eq: true },
              },
            ],
          },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };
    // A schema that (realistically) doesn't special-case the conditional
    // requirement itself — it's the FieldCondition's hidden-field exclusion
    // that's supposed to keep this from blocking, not the schema.
    const schema = z.object({ isCompany: z.boolean(), vatId: z.string().min(1) });

    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit
          screen={wizardScreen}
          entity={companyEntity}
          featureName="orders"
          initial={{ isCompany: false, vatId: "", count: 0 } as never}
          writeCommand="order:create"
          schema={schema}
        />
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("field-vatId")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-wizard-next")).toBeNull();
  });

  // A section that's entirely hidden (every field in it currently
  // condition-hidden) must not occupy its own wizard step — it would render
  // empty and the step count/progress would include a step nobody can see.
  test("a fully-hidden section is skipped in the wizard step count instead of rendering an empty step", async () => {
    const wizardScreen: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard-hidden-section",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          {
            title: "Company-only",
            columns: 1,
            fields: [{ field: "notes", visible: { field: "isUrgent", eq: true } }],
          },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };

    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={wizardScreen}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    // Only 2 real steps (Basics, Details) — "Company-only" is entirely
    // hidden (isUrgent is false) and must not count as a step.
    expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("of 2");

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });

    // Landed directly on Details, skipping the hidden "Company-only" step.
    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-wizard-next")).toBeNull();
  });

  // A server-side field error can land on a field belonging to a step the
  // user isn't currently viewing — the old `setFormError(fieldIssues.length
  // === 0 ? result.error : null)` rule suppressed the banner in that case
  // (field issues exist) while the field itself was invisible on the
  // current step, silently hiding the error entirely.
  test("a server field error for a step that's not currently shown jumps the wizard there and shows the field error", async () => {
    const write = mock(
      async () =>
        ({
          isSuccess: false,
          error: {
            code: "validation_failed",
            httpStatus: 422,
            i18nKey: "kumiko.errors.validation",
            message: "Validation failed",
            details: {
              fields: [{ path: "title", code: "too_small", i18nKey: "kumiko.errors.required" }],
            },
          },
        }) as never,
    );
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={makeWizardScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

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

    // Jumped back to the step that owns `title`, where the server error lives.
    expect(screen.getByTestId("field-title")).toBeTruthy();
    expect(screen.getByTestId("field-title-errors")).toBeTruthy();
    expect(screen.getByTestId("field-count").closest("[hidden]")).not.toBeNull();
    // The field itself shows the error — no redundant top-level banner.
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
  });

  // A root-level issue (e.g. a cross-field `.refine()`) has no field to jump
  // to — it must NOT be silently suppressed just because `details.fields`
  // is non-empty.
  test("a root-level server error with no matching field is not suppressed — the banner shows", async () => {
    const write = mock(
      async () =>
        ({
          isSuccess: false,
          error: {
            code: "validation_failed",
            httpStatus: 422,
            i18nKey: "kumiko.errors.validation",
            message: "Validation failed",
            details: {
              fields: [{ path: "(root)", code: "custom", i18nKey: "kumiko.errors.cross-field" }],
            },
          },
        }) as never,
    );
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={makeWizardScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

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

    expect(screen.getByTestId("render-edit-form-error")).toBeTruthy();
  });

  test("a server root issue without a field shows once, in the banner", async () => {
    const write = mock(
      async () =>
        ({
          isSuccess: false,
          error: {
            code: "validation_failed",
            httpStatus: 422,
            i18nKey: "kumiko.errors.validation",
            message: "Validation failed",
            details: {
              fields: [{ path: "(root)", code: "custom", i18nKey: "kumiko.errors.cross-field" }],
            },
          },
        }) as never,
    );
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );
    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });
    expect(screen.getByTestId("render-edit-form-error-root").textContent).toBe(
      "kumiko.errors.cross-field",
    );
    expect(screen.queryByTestId("render-edit-root-issue")).toBeNull();
  });

  // An extension section on an earlier wizard step used to unmount when the
  // wizard advanced (only the current step's section was rendered), which
  // tore down its useExtensionFormSubmit registration (registry.remove on
  // unmount). Finish then only ran the last-mounted step's handler and
  // silently dropped the earlier step's write. Steps must stay mounted
  // (hidden, not unmounted) so every step's handler survives to Finish.
  test("an extension section on an earlier wizard step still submits on Finish after navigating past it", async () => {
    const submitSpy = mock();
    // biome-ignore lint/correctness/noComponentHookFactories: closes over the test-local submitSpy; defined once per test run, never during a render
    const ComposedCF = (_: { entityName: string; entityId: string | null }) => {
      useExtensionFormSubmit({
        dirty: true,
        onSubmit: async (ctx) => {
          submitSpy(ctx);
          return { isSuccess: true as const };
        },
      });
      return <div data-testid="composed-cf" />;
    };

    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard-extension",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        sections: [
          {
            kind: "extension",
            title: "Custom Fields",
            component: { react: { __component: "ComposedCF" } },
            contributesToFormSubmit: true,
          },
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
        ],
      },
    };

    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ ComposedCF }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0 } as TestValues}
            entityId="order-1"
            writeCommand="order:update"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("composed-cf")).toBeTruthy();

    fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
    expect(screen.getByTestId("field-title")).toBeTruthy();
    // Step 1's extension section stayed mounted (hidden), not unmounted.
    expect(screen.getByTestId("composed-cf").closest("[hidden]")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-submit"));
      await Promise.resolve();
    });

    expect(submitSpy).toHaveBeenCalledWith({ entityId: "order-1" });
  });
});
