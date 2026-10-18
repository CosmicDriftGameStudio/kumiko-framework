// Held-but-unavailable options stay visible and pinned: an Admin must not be
// able to "remove" a role the write path would keep anyway.

import { describe, expect, test } from "bun:test";
import type { Dispatcher, EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives.tsx";
import { RenderField } from "../render-field.tsx";

let capturedInputs: InputProps[] = [];
const captureInput: ComponentType<InputProps> = (props) => {
  capturedInputs.push(props);
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: noop,
  Field: passChildren,
  Input: captureInput,
  DataTable: noop,
  Form: noop,
  Section: noop,
  Card: noop,
  Grid: passChildren,
  GridCell: passChildren,
  Text: noop,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

const AVAILABILITY_QUERY = "tenant:query:member-role-availability";

function stubDispatcher(): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async (type: string) =>
      type === AVAILABILITY_QUERY
        ? {
            isSuccess: true,
            data: {
              rows: [
                { value: "TenantAdmin", disabled: true },
                { value: "SystemAdmin", disabled: true },
              ],
            },
          }
        : { isSuccess: true, data: { rows: [] } }) as unknown as Dispatcher["query"],
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

function rolesField(overrides: Partial<EditFieldViewModel>): EditFieldViewModel {
  return {
    field: "roles",
    label: "Roles",
    type: "multiSelect",
    value: ["TenantAdmin"],
    visible: true,
    readOnly: false,
    required: false,
    options: ["User", "TenantAdmin", "SystemAdmin"],
    selectOptionsAvailabilityQuery: { query: AVAILABILITY_QUERY, payload: {} },
    ...overrides,
  };
}

let lastOnChange: unknown;
function renderField(field: EditFieldViewModel): void {
  capturedInputs = [];
  lastOnChange = undefined;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver()}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <PrimitivesProvider value={testPrimitives}>
          <RenderField field={field} onChange={(v) => (lastOnChange = v)} />
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

// Each render appends one input per option; only the newest pass is current.
function currentCheckboxes(): InputProps[] {
  const firstId = "kumiko-edit-roles-User";
  const start = capturedInputs.map((i) => (i.kind === "boolean" ? i.id : "")).lastIndexOf(firstId);
  return capturedInputs.slice(start);
}

function lastInput(): InputProps | undefined {
  return capturedInputs[capturedInputs.length - 1];
}

describe("multiSelect optionsAvailabilityQuery with a held, unavailable value", () => {
  test("checkbox grid lists the held option disabled and drops the unavailable one", async () => {
    renderField(rolesField({ display: "checkboxes" }));
    await waitFor(() => expect(currentCheckboxes().length).toBe(2));
    const current = currentCheckboxes();
    const ids = current.map((i) => (i.kind === "boolean" ? i.id : undefined));
    expect(ids).toContain("kumiko-edit-roles-TenantAdmin");
    expect(ids).not.toContain("kumiko-edit-roles-SystemAdmin");
    const held = current.find(
      (i) => i.kind === "boolean" && i.id === "kumiko-edit-roles-TenantAdmin",
    );
    expect(held?.disabled).toBe(true);
    const free = current.find((i) => i.kind === "boolean" && i.id === "kumiko-edit-roles-User");
    expect(free?.disabled).toBeFalsy();
  });

  test("checkbox grid keeps the held value when another option is toggled", async () => {
    renderField(rolesField({ display: "checkboxes" }));
    await waitFor(() => expect(currentCheckboxes().length).toBe(2));
    const user = currentCheckboxes().find(
      (i) => i.kind === "boolean" && i.id === "kumiko-edit-roles-User",
    );
    if (user?.kind === "boolean") user.onChange(true);
    expect(lastOnChange).toEqual(["User", "TenantAdmin"]);
  });

  test("combobox merges a removed held value back in", async () => {
    renderField(rolesField({}));
    await waitFor(() => {
      const input = lastInput();
      expect(input?.kind === "combobox" && input.options.length === 2).toBe(true);
    });
    const input = lastInput();
    if (input?.kind === "combobox" && input.multiple === true) input.onChange(["User"]);
    expect(lastOnChange).toEqual(["User", "TenantAdmin"]);
  });
});
