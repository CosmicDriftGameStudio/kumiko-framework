// A writeOnly field arrives as `true` (set) / `null` (empty), never as the
// secret. This renders the real update path and inspects the actual write()
// payload: untouched/empty submits must not send the field, "Remove" sends
// null, "Undo" cancels the removal, typing sends the new string.

import { afterEach, describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, FormEvent, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import {
  type ButtonProps,
  type CorePrimitives,
  type FormProps,
  type InputProps,
  PrimitivesProvider,
} from "../../primitives.js";
import type { FeatureSchema } from "../feature-schema.js";
import { KumikoScreen } from "../kumiko-screen.js";
import { NavProvider } from "../nav.js";

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
const domButton: ComponentType<ButtonProps> = (props) => (
  <button type="button" onClick={() => void props.onClick?.()}>
    {props.children}
  </button>
);

const testPrimitives: CorePrimitives = {
  Button: domButton,
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

function buildSchema(apiKeyRequired: boolean): FeatureSchema {
  const entity: EntityDefinition = {
    fields: {
      name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
      apiKey: {
        type: "text",
        maxLength: 200,
        required: apiKeyRequired,
        searchable: false,
        sortable: false,
        sensitive: true,
        writeOnly: true,
      },
    },
  };
  const screenDef: EntityEditScreenDefinition = {
    id: "widget-edit",
    type: "entityEdit",
    entity: "widget",
    layout: { sections: [{ columns: 1, fields: ["name", "apiKey"] }] },
  };
  return {
    featureName: "widgets",
    entities: { widget: entity },
    screens: [screenDef],
  } as FeatureSchema;
}

function mountEdit(record: Readonly<Record<string, unknown>>, apiKeyRequired = false): void {
  lastWrite = undefined;
  capturedFormSubmit = undefined;
  for (const key of Object.keys(capturedInputs)) delete capturedInputs[key];
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
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
            <KumikoScreen
              schema={buildSchema(apiKeyRequired)}
              qn="widgets:screen:widget-edit"
              entityId="w1"
            />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

async function submitAndReadChanges(): Promise<Record<string, unknown>> {
  await waitFor(() => {
    expect(capturedFormSubmit).toBeDefined();
  });
  act(() => capturedFormSubmit?.());
  await waitFor(() => {
    expect(lastWrite).toBeDefined();
  });
  return (requireLastWrite().payload as { changes: Record<string, unknown> }).changes;
}

function requirePasswordInput(): Extract<InputProps, { kind: "password" }> {
  const input = capturedInputs["apiKey"];
  if (input?.kind !== "password") throw new Error("expected a masked input for the apiKey field");
  return input;
}

const SET_RECORD = { id: "w1", version: 3, name: "Widget", apiKey: true };

afterEach(cleanup);

describe("entityEdit writeOnly field", () => {
  test("a set value shows the keep-placeholder and an empty save does not send the field", async () => {
    mountEdit(SET_RECORD);
    await waitFor(() => {
      expect(capturedInputs["apiKey"]).toBeDefined();
    });
    const input = requirePasswordInput();
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Set — leave empty to keep it");

    const changes = await submitAndReadChanges();
    expect(Object.hasOwn(changes, "apiKey")).toBe(false);
  });

  test("Undo cancels a pending removal", async () => {
    mountEdit(SET_RECORD);
    await waitFor(() => {
      expect(screen.getByText("Remove")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => {
      expect(screen.getByText("Removed on save")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => {
      expect(screen.queryByText("Removed on save")).toBeNull();
    });
    const changes = await submitAndReadChanges();
    expect(Object.hasOwn(changes, "apiKey")).toBe(false);
  });

  test("Remove then save sends null", async () => {
    mountEdit(SET_RECORD);
    await waitFor(() => {
      expect(screen.getByText("Remove")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => {
      expect(screen.getByText("Removed on save")).toBeDefined();
    });
    const changes = await submitAndReadChanges();
    expect(changes["apiKey"]).toBeNull();
  });

  test("typing a new value sends the string", async () => {
    mountEdit(SET_RECORD);
    await waitFor(() => {
      expect(capturedInputs["apiKey"]).toBeDefined();
    });
    act(() => requirePasswordInput().onChange("sk-new"));
    const changes = await submitAndReadChanges();
    expect(changes["apiKey"]).toBe("sk-new");
  });

  test("a required set field offers no Remove and counts as filled", async () => {
    mountEdit(SET_RECORD, true);
    await waitFor(() => {
      expect(capturedInputs["apiKey"]).toBeDefined();
    });
    expect(screen.queryByText("Remove")).toBeNull();
    const changes = await submitAndReadChanges();
    expect(Object.hasOwn(changes, "apiKey")).toBe(false);
  });
});
