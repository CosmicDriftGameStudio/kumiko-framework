import { describe, expect, test } from "bun:test";
import type { EntityDefinition, EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import { type CorePrimitives, PrimitivesProvider, type SectionProps } from "../../primitives";
import { RenderEdit, type RenderEditAction } from "../render-edit";

const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const noop = () => {};

const renderSection: ComponentType<SectionProps> = ({ testId, children }) => (
  <div data-testid={testId}>{children}</div>
);

const testButton: ComponentType<{
  children?: ReactNode;
  onClick?: () => void;
  testId?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}> = ({ children, onClick, testId, type, disabled }) => (
  <button type={type ?? "button"} data-testid={testId} onClick={onClick} disabled={disabled}>
    {children}
  </button>
);

const testForm: ComponentType<{
  children?: ReactNode;
  actions?: ReactNode;
  onSubmit?: () => void;
}> = ({ children, actions, onSubmit }) => (
  <form
    onSubmit={(e) => {
      e.preventDefault();
      onSubmit?.();
    }}
  >
    {children}
    {actions}
  </form>
);

const testInput: ComponentType<{
  name?: string;
  value?: unknown;
  onChange?: (v: unknown) => void;
}> = ({ name = "field", value, onChange }) => (
  <input
    aria-label={name}
    data-testid={`input-${name}`}
    value={typeof value === "string" ? value : ""}
    onChange={(e) => onChange?.(e.target.value)}
  />
);

function testPrimitives(): CorePrimitives {
  return {
    Button: testButton,
    Banner: noop,
    Field: passChildren,
    Input: testInput,
    DataTable: noop,
    Form: testForm,
    Section: renderSection,
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
  } as unknown as CorePrimitives;
}

function buildEntity(): EntityDefinition {
  return {
    fields: {
      name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
    },
  };
}

function renderEdit(
  screen: EntityEditScreenDefinition,
  overrides: Record<string, unknown> = {},
) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={testPrimitives()}>
        <RenderEdit
          screen={screen}
          entity={buildEntity()}
          featureName="contacts"
          initial={{ name: "" }}
          {...overrides}
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

const oneFieldScreen: EntityEditScreenDefinition = {
  id: "contact-edit",
  type: "entityEdit",
  entity: "contact",
  layout: { sections: [{ title: "Main", fields: ["name"] }] },
};

describe("RenderEdit — submit path", () => {
  test("changing a field and saving calls onSubmit with a successful result", async () => {
    let submitted: { isSuccess?: boolean } | undefined;
    renderEdit(oneFieldScreen, {
      customSubmit: (async () => ({ isSuccess: true, data: { id: "n1" } })) as never,
      onSubmit: ((result: unknown) => {
        submitted = result as { isSuccess?: boolean };
      }) as never,
    });

    fireEvent.change(rtlScreen.getByLabelText(/name/i), { target: { value: "Ferdinand" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted?.isSuccess).toBe(true);
  });

  test("submit stays disabled while the form is unchanged and enables after edits", async () => {
    const onSubmitted = () => {
      throw new Error("must not fire");
    };
    const view = renderEdit(oneFieldScreen, {
      customSubmit: (async () => ({ isSuccess: true })) as never,
      onSubmit: (onSubmitted as never),
    });

    const save = rtlScreen.getByTestId("render-edit-submit") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(rtlScreen.getByLabelText(/name/i), { target: { value: "X" } });
    await waitFor(() => expect(save.disabled).toBe(false));
    view.unmount();
  });
});

describe("RenderEdit — custom actions", () => {
  test("renders an action button and runs its handler on click", async () => {
    let pressed = 0;
    renderEdit(oneFieldScreen, {
      actions: [
        {
          id: "ping",
          label: "Ping",
          onPress: async () => {
            pressed += 1;
          },
        } as unknown as RenderEditAction,
      ],
    });

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-ping"));
    await waitFor(() => expect(pressed).toBe(1));
  });
});
