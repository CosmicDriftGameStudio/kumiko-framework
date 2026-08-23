import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher, DispatcherError, SubmitResult } from "@cosmicdrift/kumiko-headless";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { buildFormSchema } from "../../app/form-schema";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type BannerProps,
  type CorePrimitives,
  PrimitivesProvider,
  type SectionProps,
  type TextProps,
} from "../../primitives";
import { RenderEdit, type RenderEditAction, type RenderEditProps } from "../render-edit";

type Values = { name: string };

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

const testBanner: ComponentType<BannerProps> = ({ children, testId }) => (
  <div data-testid={testId}>{children}</div>
);

const testText: ComponentType<TextProps> = ({ children, testId }) => (
  <span data-testid={testId}>{children}</span>
);

function testPrimitives(): CorePrimitives {
  return {
    Button: testButton,
    Banner: testBanner,
    Field: passChildren,
    Input: testInput,
    DataTable: noop,
    Form: testForm,
    Section: renderSection,
    Card: passChildren,
    Grid: passChildren,
    GridCell: passChildren,
    Text: testText,
    Heading: noop,
    Dialog: noop,
    Modal: noop,
    Lightbox: noop,
    ConfigSourceBadge: noop,
    ConfigCascadeView: noop,
    Link: noop,
  } as unknown as CorePrimitives;
}

function buildEntity(required = false): EntityDefinition {
  return {
    fields: {
      name: {
        type: "text",
        maxLength: 200,
        required,
        searchable: false,
        sortable: false,
      },
    },
  };
}

function stubDispatcher(
  writeImpl?: Dispatcher["write"],
): { dispatcher: Dispatcher; writes: Array<{ type: string; payload: unknown }> } {
  const writes: Array<{ type: string; payload: unknown }> = [];
  const dispatcher: Dispatcher = {
    write: (async (type, payload) => {
      writes.push({ type, payload });
      if (writeImpl) return writeImpl(type, payload);
      return { isSuccess: true, data: { id: "n1" } };
    }) as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: {} })) as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
  return { dispatcher, writes };
}

function renderEdit(
  screen: EntityEditScreenDefinition,
  overrides: Partial<RenderEditProps<Values>> = {},
  entity: EntityDefinition = buildEntity(),
  dispatcher?: Dispatcher,
) {
  const body = (
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={testPrimitives()}>
        <RenderEdit
          screen={screen}
          entity={entity}
          featureName="contacts"
          initial={{ name: "" }}
          {...overrides}
        />
      </PrimitivesProvider>
    </LocaleProvider>
  );
  return render(
    dispatcher !== undefined ? (
      <DispatcherProvider dispatcher={dispatcher}>{body}</DispatcherProvider>
    ) : (
      body
    ),
  );
}

const oneFieldScreen: EntityEditScreenDefinition = {
  id: "contact-edit",
  type: "entityEdit",
  entity: "contact",
  layout: { sections: [{ title: "Main", fields: ["name"] }] },
};

const writeFailure: DispatcherError = {
  code: "conflict",
  httpStatus: 409,
  i18nKey: "errors.conflict",
  message: "conflict",
};

describe("RenderEdit — submit path", () => {
  test("changing a field and saving calls onSubmit with a successful result", async () => {
    let submitted: SubmitResult<unknown> | undefined;
    renderEdit(oneFieldScreen, {
      customSubmit: async () => ({
        validationBlocked: false,
        isSuccess: true,
        data: { id: "n1" },
      }),
      onSubmit: (result) => {
        submitted = result;
      },
    });

    fireEvent.change(rtlScreen.getByLabelText(/name/i), { target: { value: "Ferdinand" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted?.isSuccess).toBe(true);
  });

  test("submit stays disabled while the form is unchanged and enables after edits", async () => {
    const view = renderEdit(oneFieldScreen, {
      customSubmit: async () => ({ validationBlocked: false, isSuccess: true, data: {} }),
      onSubmit: () => {
        throw new Error("must not fire while disabled");
      },
    });

    const save = rtlScreen.getByTestId("render-edit-submit") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(rtlScreen.getByLabelText(/name/i), { target: { value: "X" } });
    await waitFor(() => expect(save.disabled).toBe(false));
    view.unmount();
  });

  test("failed customSubmit surfaces the form-error banner and notifies onSubmit", async () => {
    let submitted: SubmitResult<unknown> | undefined;
    let customCalls = 0;
    renderEdit(oneFieldScreen, {
      customSubmit: async () => {
        customCalls += 1;
        return { validationBlocked: false, isSuccess: false, error: writeFailure };
      },
      onSubmit: (result) => {
        submitted = result;
      },
    });

    fireEvent.change(rtlScreen.getByLabelText(/name/i), { target: { value: "Ferdinand" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(rtlScreen.getByTestId("render-edit-form-error")).toBeTruthy());
    // LocaleProvider resolves i18nKey → human copy; pin the error code via onSubmit.
    expect(rtlScreen.getByTestId("render-edit-form-error-key").textContent?.length).toBeGreaterThan(
      0,
    );
    expect(customCalls).toBe(1);
    expect(submitted).toEqual({
      validationBlocked: false,
      isSuccess: false,
      error: writeFailure,
    });
  });

  test("schema validation blocks customSubmit and notifies validationBlocked", async () => {
    let submitted: SubmitResult<unknown> | undefined;
    let customCalls = 0;
    const entity = buildEntity(true);
    // RenderEdit only validates when a schema is passed (kumiko-screen builds it
    // via buildFormSchema). Without it, entity.required is display-only here.
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <PrimitivesProvider value={testPrimitives()}>
          <RenderEdit
            screen={oneFieldScreen}
            entity={entity}
            featureName="contacts"
            initial={{ name: "seed" }}
            schema={buildFormSchema(entity, oneFieldScreen)}
            customSubmit={async () => {
              customCalls += 1;
              return { validationBlocked: false, isSuccess: true, data: {} };
            }}
            onSubmit={(result) => {
              submitted = result;
            }}
          />
        </PrimitivesProvider>
      </LocaleProvider>,
    );

    // Clear the required field; form stays dirty vs initial "seed".
    fireEvent.change(rtlScreen.getByLabelText(/name/i), { target: { value: "" } });
    await waitFor(() =>
      expect((rtlScreen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toEqual({ validationBlocked: true, isSuccess: false });
    expect(customCalls).toBe(0);
  });
});

describe("RenderEdit — custom actions", () => {
  test("renders an action button and runs its handler on click", async () => {
    let pressed = 0;
    const actions: readonly RenderEditAction[] = [
      {
        id: "ping",
        label: "Ping",
        onPress: async () => {
          pressed += 1;
        },
      },
    ];
    renderEdit(oneFieldScreen, { actions });

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-ping"));
    await waitFor(() => expect(pressed).toBe(1));
  });

  test("action handler failure shows the action-error banner", async () => {
    const actions: readonly RenderEditAction[] = [
      {
        id: "boom",
        label: "Boom",
        onPress: async () => {
          throw new Error("action exploded");
        },
      },
    ];
    renderEdit(oneFieldScreen, { actions });

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-boom"));
    await waitFor(() => expect(rtlScreen.getByTestId("render-edit-action-error")).toBeTruthy());
    expect(rtlScreen.getByTestId("render-edit-action-error").textContent).toContain(
      "action exploded",
    );
  });
});

describe("RenderEdit — writeCommand path", () => {
  test("successful writeCommand dispatches and notifies onSubmit", async () => {
    const { dispatcher, writes } = stubDispatcher();
    let submitted: SubmitResult<unknown> | undefined;
    renderEdit(
      oneFieldScreen,
      {
        writeCommand: "contacts:write:contact:update",
        onSubmit: (result) => {
          submitted = result;
        },
      },
      buildEntity(),
      dispatcher,
    );

    fireEvent.change(rtlScreen.getByLabelText(/name/i), { target: { value: "Ada" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted?.isSuccess).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.type).toBe("contacts:write:contact:update");
    expect(writes[0]?.payload).toMatchObject({ name: "Ada" });
  });

  test("failed writeCommand without field issues shows form-error banner", async () => {
    const writeFailure: DispatcherError = {
      code: "conflict",
      httpStatus: 409,
      i18nKey: "errors.conflict",
      message: "conflict",
    };
    const { dispatcher } = stubDispatcher(async () => ({
      isSuccess: false,
      error: writeFailure,
    }));
    let submitted: SubmitResult<unknown> | undefined;
    renderEdit(
      oneFieldScreen,
      {
        writeCommand: "contacts:write:contact:update",
        onSubmit: (result) => {
          submitted = result;
        },
      },
      buildEntity(),
      dispatcher,
    );

    fireEvent.change(rtlScreen.getByLabelText(/name/i), { target: { value: "Ada" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(rtlScreen.getByTestId("render-edit-form-error")).toBeTruthy());
    expect(submitted?.isSuccess).toBe(false);
  });
});

