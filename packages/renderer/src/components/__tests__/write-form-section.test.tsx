import { describe, expect, test } from "bun:test";
import type { Dispatcher, EditWriteFormSectionViewModel } from "@cosmicdrift/kumiko-headless";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type BannerProps,
  type ButtonProps,
  type CorePrimitives,
  PrimitivesProvider,
  type SectionProps,
} from "../../primitives";
import { WriteFormSection } from "../write-form-section";

const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
const noop = () => {};

const testButton: ComponentType<ButtonProps> = ({ children, onClick, testId, disabled }) => (
  <button type="button" data-testid={testId} onClick={onClick} disabled={disabled}>
    {children}
  </button>
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

const testSection: ComponentType<SectionProps> = ({ testId, children }) => (
  <div data-testid={testId}>{children}</div>
);

function testPrimitives(): CorePrimitives {
  return {
    Button: testButton,
    Banner: testBanner,
    Field: passChildren,
    Input: testInput,
    DataTable: noop,
    Form: noop,
    Section: testSection,
    Card: passChildren,
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
  } as unknown as CorePrimitives;
}

function stubDispatcher(writeImpl?: Dispatcher["write"]): {
  dispatcher: Dispatcher;
  writes: Array<{ type: string; payload: unknown }>;
} {
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

const noteSection: EditWriteFormSectionViewModel = {
  kind: "writeForm",
  title: "Add note",
  columns: 1,
  handler: "orders:write:add-note",
  fields: [
    {
      field: "note",
      label: "Note",
      type: "text",
      value: "",
      visible: true,
      readOnly: false,
      required: true,
    },
  ],
};

function renderWriteForm(
  section: EditWriteFormSectionViewModel,
  dispatcher: Dispatcher,
  onSubmitted: () => void,
) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <PrimitivesProvider value={testPrimitives()}>
          <WriteFormSection section={section} featureName="orders" onSubmitted={onSubmitted} />
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("WriteFormSection", () => {
  test("submit dispatches through the section's configured write handler with the entered values", async () => {
    const { dispatcher, writes } = stubDispatcher();
    let submittedCount = 0;
    renderWriteForm(noteSection, dispatcher, () => {
      submittedCount += 1;
    });

    fireEvent.change(rtlScreen.getByLabelText("note"), { target: { value: "Called back" } });
    fireEvent.click(rtlScreen.getByTestId("write-form-section-submit"));

    await waitFor(() => expect(submittedCount).toBe(1));
    expect(writes).toEqual([{ type: "orders:write:add-note", payload: { note: "Called back" } }]);
  });

  test("a failed write surfaces the error banner and does not call onSubmitted", async () => {
    const { dispatcher } = stubDispatcher(async () => ({
      isSuccess: false,
      error: { code: "conflict", httpStatus: 409, i18nKey: "errors.conflict", message: "conflict" },
    }));
    let submittedCount = 0;
    renderWriteForm(noteSection, dispatcher, () => {
      submittedCount += 1;
    });

    fireEvent.change(rtlScreen.getByLabelText("note"), { target: { value: "x" } });
    fireEvent.click(rtlScreen.getByTestId("write-form-section-submit"));

    await waitFor(() => expect(rtlScreen.getByTestId("write-form-section-error")).toBeTruthy());
    expect(submittedCount).toBe(0);
  });

  test("submit is blocked by schema validation when a required field is left empty", async () => {
    const { dispatcher, writes } = stubDispatcher();
    renderWriteForm(noteSection, dispatcher, () => {
      throw new Error("must not submit while required field is empty");
    });

    fireEvent.click(rtlScreen.getByTestId("write-form-section-submit"));

    await waitFor(() => expect(writes).toHaveLength(0));
  });
});
