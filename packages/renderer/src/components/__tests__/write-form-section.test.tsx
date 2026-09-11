import { describe, expect, test } from "bun:test";
import type {
  EditWriteFormSection,
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  computeEditViewModel,
  type Dispatcher,
  type EditWriteFormSectionViewModel,
} from "@cosmicdrift/kumiko-headless";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider, type TranslationsByLocale } from "../../i18n";
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

const testButton: ComponentType<ButtonProps> = ({ children, onClick, testId, disabled, icon }) => (
  <button type="button" data-testid={testId} data-icon={icon} onClick={onClick} disabled={disabled}>
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

// Mirrors DefaultSection's real actions slot closely enough to let tests
// assert the submit button lands in the footer, not the body (fw#2675).
// Also renders subtitle into the DOM (like DefaultSection's own subtitle
// slot) so description-passthrough tests prove real render output, not just
// a captured prop.
const testSection: ComponentType<SectionProps> = ({ testId, subtitle, children, actions }) => (
  <div data-testid={testId}>
    {subtitle !== undefined && (
      <p data-testid={testId !== undefined ? `${testId}-subtitle` : undefined}>{subtitle}</p>
    )}
    <div data-testid={testId !== undefined ? `${testId}-body` : undefined}>{children}</div>
    {actions !== undefined && (
      <div data-testid={testId !== undefined ? `${testId}-actions` : undefined}>{actions}</div>
    )}
  </div>
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
  extraTranslations?: TranslationsByLocale,
) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={
        extraTranslations !== undefined
          ? [extraTranslations, kumikoDefaultTranslations]
          : [kumikoDefaultTranslations]
      }
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
  test("submit button renders in the section's actions footer, not the body (fw#2675)", () => {
    const { dispatcher } = stubDispatcher();
    renderWriteForm(noteSection, dispatcher, noop);

    const actions = rtlScreen.getByTestId("write-form-Add note-actions");
    const body = rtlScreen.getByTestId("write-form-Add note-body");
    const button = rtlScreen.getByTestId("write-form-section-submit");

    expect(actions.contains(button)).toBe(true);
    expect(body.contains(button)).toBe(false);
    expect(button.dataset["icon"]).toBe("check");
  });

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

  // Pins the only route a writeForm section has to thread the host record's
  // id into its payload (see EditWriteFormSection.handler's doc): a
  // visible:false field never renders an input, but its resolved value still
  // seeds `initial` and so rides along in the submit payload untouched.
  test("a visible:false field's prefilled value rides along in the submit payload", async () => {
    const sectionWithHiddenId: EditWriteFormSectionViewModel = {
      ...noteSection,
      fields: [
        {
          field: "orderId",
          label: "Order",
          type: "text",
          value: "order-42",
          visible: false,
          readOnly: false,
          required: false,
        },
        ...noteSection.fields,
      ],
    };
    const { dispatcher, writes } = stubDispatcher();
    renderWriteForm(sectionWithHiddenId, dispatcher, noop);

    expect(rtlScreen.queryByTestId("input-orderId")).toBeNull();

    fireEvent.change(rtlScreen.getByLabelText("note"), { target: { value: "hi" } });
    fireEvent.click(rtlScreen.getByTestId("write-form-section-submit"));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.payload).toEqual({ orderId: "order-42", note: "hi" });
  });
});

// section.description exists on EditWriteFormSection to make a self-service
// write form usable without training (same doc-promise as EditFieldsSection),
// but WriteFormSection never read it — the ViewModel translated it correctly,
// the renderer just dropped it on the floor. Built through the real
// computeEditViewModel pipeline (not a hand-built ViewModel) to prove the
// full Spec -> ViewModel -> Renderer path, matching render-edit-screen-
// description.test.tsx's approach for the sibling entityEdit-level bug.
describe("WriteFormSection — section.description as subtitle", () => {
  function computeNoteSection(
    descriptionSpec: string,
    translate: (key: string) => string,
  ): EditWriteFormSectionViewModel {
    const sectionSpec: EditWriteFormSection = {
      kind: "writeForm",
      title: "Add note",
      description: descriptionSpec,
      columns: 1,
      handler: "orders:write:add-note",
      fieldDefs: {
        note: {
          type: "text",
          maxLength: 500,
          required: true,
          searchable: false,
          sortable: false,
        },
      },
      fields: ["note"],
    };
    const screen: EntityEditScreenDefinition = {
      id: "order-detail",
      type: "entityEdit",
      entity: "order",
      layout: { sections: [sectionSpec] },
    };
    const entity: EntityDefinition = { fields: {} };
    const viewModel = computeEditViewModel({
      screen,
      entity,
      values: {},
      translate,
      featureName: "orders",
    });
    const section = viewModel.sections[0];
    if (section?.kind !== "writeForm") throw new Error("expected a writeForm section");
    return section;
  }

  test("a plain-text description renders as the section's subtitle", () => {
    const { dispatcher } = stubDispatcher();
    const section = computeNoteSection("Explain why you're adding this note.", (key) => key);

    renderWriteForm(section, dispatcher, noop);

    expect(rtlScreen.getByTestId("write-form-Add note-subtitle").textContent).toBe(
      "Explain why you're adding this note.",
    );
  });

  test("a description that is a known i18n key renders translated, not as the raw key", () => {
    const { dispatcher } = stubDispatcher();
    const translations: Record<string, string> = {
      "orders:write-form.explainer": "Notes are visible to the whole team.",
    };
    const section = computeNoteSection(
      "orders:write-form.explainer",
      (key) => translations[key] ?? key,
    );

    renderWriteForm(section, dispatcher, noop);

    const subtitle = rtlScreen.getByTestId("write-form-Add note-subtitle");
    expect(subtitle.textContent).toBe("Notes are visible to the whole team.");
    expect(subtitle.textContent).not.toBe("orders:write-form.explainer");
  });
});
