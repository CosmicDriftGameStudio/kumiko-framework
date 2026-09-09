import { describe, expect, test } from "bun:test";
import type { Dispatcher, EditActionPreviewSectionViewModel } from "@cosmicdrift/kumiko-headless";
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
  type TextProps,
} from "../../primitives";
import { ActionPreviewSection } from "../action-preview-section";

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

const testText: ComponentType<TextProps> = ({ testId, children }) => (
  <span data-testid={testId}>{children}</span>
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

function stubDispatcher(queryImpl?: Dispatcher["query"]): {
  dispatcher: Dispatcher;
  writes: Array<{ type: string; payload: unknown }>;
  queries: Array<{ type: string; payload: unknown }>;
} {
  const writes: Array<{ type: string; payload: unknown }> = [];
  const queries: Array<{ type: string; payload: unknown }> = [];
  const dispatcher: Dispatcher = {
    write: (async (type, payload) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: {} };
    }) as Dispatcher["write"],
    query: (async (type, payload) => {
      queries.push({ type, payload });
      if (queryImpl) return queryImpl(type, payload);
      return { isSuccess: true, data: {} };
    }) as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
  return { dispatcher, writes, queries };
}

const previewSection: EditActionPreviewSectionViewModel = {
  kind: "actionPreview",
  title: "Test run",
  columns: 1,
  handler: "channel-text:query:preview",
  fields: [
    {
      field: "vehicleId",
      label: "Vehicle",
      type: "text",
      value: "",
      visible: true,
      readOnly: false,
      required: true,
    },
  ],
  resultFields: [
    {
      field: "current",
      label: "Current",
      type: "text",
      value: undefined,
      visible: true,
      readOnly: true,
      required: false,
    },
    {
      field: "generated",
      label: "Generated",
      type: "text",
      value: undefined,
      visible: true,
      readOnly: true,
      required: false,
    },
  ],
};

function renderPreview(section: EditActionPreviewSectionViewModel, dispatcher: Dispatcher) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <PrimitivesProvider value={testPrimitives()}>
          <ActionPreviewSection section={section} featureName="channel-text" />
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("ActionPreviewSection", () => {
  test("no result area is rendered before the first run", () => {
    const { dispatcher } = stubDispatcher();
    renderPreview(previewSection, dispatcher);

    expect(rtlScreen.queryByTestId("action-preview-section-result")).toBeNull();
  });

  test("a successful run dispatches through the handler and renders the resultFields values", async () => {
    const { dispatcher, queries, writes } = stubDispatcher(async () => ({
      isSuccess: true,
      data: { current: "old text", generated: "new text" },
    }));
    renderPreview(previewSection, dispatcher);

    fireEvent.change(rtlScreen.getByLabelText("vehicleId"), { target: { value: "v1" } });
    fireEvent.click(rtlScreen.getByTestId("action-preview-section-run"));

    await waitFor(() => expect(rtlScreen.getByTestId("action-preview-section-result")).toBeTruthy());
    expect(rtlScreen.getByTestId("field-value-current").textContent).toBe("old text");
    expect(rtlScreen.getByTestId("field-value-generated").textContent).toBe("new text");
    expect(queries).toEqual([
      { type: "channel-text:query:preview", payload: { vehicleId: "v1" } },
    ]);
    expect(writes).toHaveLength(0);
  });

  test("a failed run shows the error banner and renders no result", async () => {
    const { dispatcher } = stubDispatcher(async () => ({
      isSuccess: false,
      error: { code: "conflict", httpStatus: 409, i18nKey: "errors.conflict", message: "conflict" },
    }));
    renderPreview(previewSection, dispatcher);

    fireEvent.change(rtlScreen.getByLabelText("vehicleId"), { target: { value: "v1" } });
    fireEvent.click(rtlScreen.getByTestId("action-preview-section-run"));

    await waitFor(() =>
      expect(rtlScreen.getByTestId("action-preview-section-error")).toBeTruthy(),
    );
    expect(rtlScreen.queryByTestId("action-preview-section-result")).toBeNull();
  });

  test("run is blocked by schema validation when a required input is left empty — no dispatch at all", async () => {
    const { dispatcher, queries, writes } = stubDispatcher();
    renderPreview(previewSection, dispatcher);

    fireEvent.click(rtlScreen.getByTestId("action-preview-section-run"));

    await waitFor(() => expect(queries).toHaveLength(0));
    expect(writes).toHaveLength(0);
  });
});
