// Finding: render-field-unsupported-types.test.tsx only proves jsonb/embedded
// (no embeddedListCells) fields render read-only (Banner, no Input wired up).
// It never proves the actual claim that matters: saving the form after
// editing an UNRELATED field does not corrupt or overwrite those fields'
// real data. Because RenderField never wires an onChange for them, their
// value in the form controller stays reference-identical to the record it
// was seeded from — the update payload's `changes` diff (reference-equality
// based, see form-controller.ts valuesDiff) must therefore omit them
// entirely, never re-include them as e.g. a stringified copy.
//
// This renders the real update path (KumikoScreen → EntityEditScreen →
// EntityEditUpdateBody → RenderEdit → RenderField) under a stub dispatcher
// and inspects the actual write() payload, not just the render tree.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, render, waitFor } from "@testing-library/react";
import type { ComponentType, FormEvent, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type CorePrimitives,
  type FormProps,
  type InputProps,
  PrimitivesProvider,
} from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import { NavProvider } from "../nav";

const capturedInputs: Record<string, InputProps | undefined> = {};
const captureInput: ComponentType<InputProps> = (props) => {
  capturedInputs[props.name] = props;
  return null;
};
let capturedFormSubmit: ((e?: FormEvent) => void) | undefined;
const captureForm: ComponentType<FormProps> = (props) => {
  capturedFormSubmit = props.onSubmit;
  return <>{props.children}</>;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: passChildren,
  Field: passChildren,
  Input: captureInput,
  DataTable: noop,
  Form: captureForm,
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

let lastWrite: { type: string; payload: unknown } | undefined;

// The annotation resets TS's flow-narrowing, which only tracks the
// straight-line `lastWrite = undefined` reset, not the reassignment inside the dispatcher closure.
function requireLastWrite(): { type: string; payload: unknown } {
  const write: { type: string; payload: unknown } | undefined = lastWrite;
  if (!write) throw new Error("expected a write() call");
  return write;
}

function stubDispatcher(record: Readonly<Record<string, unknown>>): Dispatcher {
  return {
    write: (async (type: string, payload: unknown) => {
      lastWrite = { type, payload };
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: record })) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

function buildSchema(): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
      extra: { type: "jsonb" },
      meta: {
        type: "embedded",
        schema: { note: { type: "text" } },
      },
    },
  };
  const screen: EntityEditScreenDefinition = {
    id: "widget-edit",
    type: "entityEdit",
    entity: "widget",
    layout: { sections: [{ columns: 1, fields: ["name", "extra", "meta"] }] },
  };
  return {
    featureName: "widgets",
    entities: { widget: entity },
    screens: [screen],
  } as FeatureSchema;
}

describe("EntityEditUpdateForm — untouched jsonb/embedded fields survive submit", () => {
  test("changing an unrelated field and submitting keeps jsonb/embedded fields out of the diff (not stringified, not overwritten)", async () => {
    lastWrite = undefined;
    capturedFormSubmit = undefined;
    for (const key of Object.keys(capturedInputs)) delete capturedInputs[key];

    const record = {
      id: "w1",
      version: 3,
      name: "Old name",
      extra: { a: 1 },
      meta: { note: "keep me" },
    };

    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "de-DE" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={stubDispatcher(record)}>
          <NavProvider
            value={{
              route: { screenId: "widgets:widget-edit" },
              navigate: () => {},
              replace: () => {},
              hrefFor: () => "",
              searchParams: {},
              setSearchParams: () => {},
            }}
          >
            <PrimitivesProvider value={testPrimitives}>
              <KumikoScreen schema={buildSchema()} qn="widgets:screen:widget-edit" entityId="w1" />
            </PrimitivesProvider>
          </NavProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(capturedInputs["name"]).toBeDefined();
    });

    const nameInput = capturedInputs["name"];
    if (nameInput?.kind !== "text") throw new Error("expected a text input for the name field");
    act(() => nameInput.onChange("New name"));

    await waitFor(() => {
      expect(capturedFormSubmit).toBeDefined();
    });
    act(() => capturedFormSubmit?.());

    await waitFor(() => {
      expect(lastWrite).toBeDefined();
    });

    const payload = requireLastWrite().payload as { changes: Record<string, unknown> };
    expect(payload.changes["name"]).toBe("New name");
    // The untouched jsonb/embedded fields must never resurface in the diff —
    // if they did (the pre-fix bug this guards against), it would mean the
    // update overwrites them, and the old code path could send a corrupted
    // (e.g. stringified) copy instead of the real object.
    expect(Object.hasOwn(payload.changes, "extra")).toBe(false);
    expect(Object.hasOwn(payload.changes, "meta")).toBe(false);
  });

  test("touching the jsonb field itself keeps it a real object in the diff, never a string", async () => {
    lastWrite = undefined;
    capturedFormSubmit = undefined;
    for (const key of Object.keys(capturedInputs)) delete capturedInputs[key];

    const record = {
      id: "w1",
      version: 3,
      name: "Old name",
      extra: { a: 1 },
      meta: { note: "keep me" },
    };

    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "de-DE" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={stubDispatcher(record)}>
          <NavProvider
            value={{
              route: { screenId: "widgets:widget-edit" },
              navigate: () => {},
              replace: () => {},
              hrefFor: () => "",
              searchParams: {},
              setSearchParams: () => {},
            }}
          >
            <PrimitivesProvider value={testPrimitives}>
              <KumikoScreen schema={buildSchema()} qn="widgets:screen:widget-edit" entityId="w1" />
            </PrimitivesProvider>
          </NavProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(capturedFormSubmit).toBeDefined();
    });
    act(() => capturedFormSubmit?.());

    await waitFor(() => {
      expect(lastWrite).toBeDefined();
    });

    const payload = requireLastWrite().payload as { changes: Record<string, unknown> };
    // Nothing was touched at all — the diff must be empty, and specifically
    // must not contain a stringified copy of extra/meta.
    expect(Object.hasOwn(payload.changes, "extra")).toBe(false);
    expect(Object.hasOwn(payload.changes, "meta")).toBe(false);
  });
});
