import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { createStore } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives";
import { RenderField } from "../render-field";

let capturedInput: InputProps | undefined;
let capturedField: Record<string, unknown> | undefined;

const captureInput: ComponentType<InputProps> = (props) => {
  capturedInput = props;
  return null;
};
const captureField: ComponentType<{ readonly children?: ReactNode } & Record<string, unknown>> = ({
  children,
  ...props
}) => {
  capturedField = props;
  return children;
};
const noop = (): ReactNode => null;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: noop,
  Field: captureField as CorePrimitives["Field"],
  Input: captureInput,
  DataTable: noop,
  Form: noop,
  Section: noop,
  Card: noop,
  Grid: noop,
  GridCell: noop,
  Text: noop,
  Heading: noop,
  Dialog: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

function baseField(overrides: Partial<EditFieldViewModel> = {}): EditFieldViewModel {
  return {
    field: "f",
    label: "Field",
    type: "text",
    value: "",
    visible: true,
    readOnly: false,
    required: false,
    ...overrides,
  };
}

function renderField(field: EditFieldViewModel, featureName = "items"): void {
  capturedInput = undefined;
  capturedField = undefined;
  const dispatcher = {
    query: async () =>
      ({ isSuccess: true as const, data: { rows: [{ id: "r1", name: "Ref One" }] } }) as const,
    write: async () => ({ isSuccess: true as const, data: {} }) as const,
    batch: async () => ({ isSuccess: true as const, results: [] }) as const,
    statusStore: createStore("online" as const),
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
      <DispatcherProvider dispatcher={dispatcher}>
        <PrimitivesProvider value={testPrimitives}>
          <RenderField
            field={field}
            onChange={() => {}}
            featureName={featureName}
            labelAppendix={<span>badge</span>}
            fieldAppendix={<span>extra</span>}
            issues={[{ field: field.field, message: "bad", code: "x" }]}
          />
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("RenderField — field type branches", () => {
  test("invisible field returns null", () => {
    renderField(baseField({ visible: false }));
    expect(capturedInput).toBeUndefined();
    expect(capturedField).toBeUndefined();
  });

  test("number input", () => {
    renderField(baseField({ type: "number", value: 42 }));
    expect(capturedInput?.kind).toBe("number");
    if (capturedInput?.kind === "number") expect(capturedInput.value).toBe(42);
  });

  test("money input with currency override", () => {
    renderField(
      baseField({
        type: "money",
        value: 10,
        ...( { currency: "EUR" } as Record<string, unknown> ),
      }),
    );
    expect(capturedInput?.kind).toBe("money");
    if (capturedInput?.kind === "money") {
      expect(capturedInput.currency).toBe("EUR");
      expect(capturedInput.locale).toBe("de-DE");
    }
  });

  test("boolean uses inline Field layout", () => {
    renderField(baseField({ type: "boolean", value: true }));
    expect(capturedInput?.kind).toBe("boolean");
    expect(capturedField?.layout).toBe("inline");
  });

  test("select maps optionLabels", () => {
    renderField(
      baseField({
        type: "select",
        value: "a",
        options: ["a", "b"],
        optionLabels: { a: "Alpha" },
      }),
    );
    expect(capturedInput?.kind).toBe("select");
    if (capturedInput?.kind === "select") {
      expect(capturedInput.options).toEqual([
        { value: "a", label: "Alpha" },
        { value: "b", label: "b" },
      ]);
    }
  });

  test("text multiline renders textarea", () => {
    renderField(
      baseField({
        type: "text",
        multiline: { rows: 4 },
        value: "hello",
      }),
    );
    expect(capturedInput?.kind).toBe("textarea");
    if (capturedInput?.kind === "textarea") expect(capturedInput.rows).toBe(4);
  });

  test("unknown type falls back to text", () => {
    renderField(baseField({ type: "custom" as EditFieldViewModel["type"], value: "x" }));
    expect(capturedInput?.kind).toBe("text");
  });

  test("file and image kinds pass accept metadata", () => {
    renderField(
      baseField({
        type: "file",
        value: "file-id",
        accept: ".pdf",
        maxSize: 1024,
        entityType: "doc",
        fieldName: "attachment",
      }),
    );
    expect(capturedInput?.kind).toBe("file");
    if (capturedInput?.kind === "file") {
      expect(capturedInput.accept).toBe(".pdf");
      expect(capturedInput.maxSize).toBe(1024);
    }

    renderField(baseField({ type: "image", value: "" }));
    expect(capturedInput?.kind).toBe("image");
    if (capturedInput?.kind === "image") expect(capturedInput.value).toBeNull();
  });

  test("timestamp + locatedTimestamp pass constraints", () => {
    renderField(
      baseField({
        type: "timestamp",
        value: "2026-01-01T12:00:00Z",
        wallClock: true,
        min: "2026-01-01",
        max: "2026-12-31",
      }),
    );
    expect(capturedInput?.kind).toBe("timestamp");
    if (capturedInput?.kind === "timestamp") {
      expect(capturedInput.wallClock).toBe(true);
      expect(capturedInput.min).toBe("2026-01-01");
    }

    renderField(
      baseField({
        type: "locatedTimestamp",
        value: { at: "2026-01-01T12:00:00", tz: "Europe/Berlin", utc: "2026-01-01T11:00:00Z" },
      }),
    );
    expect(capturedInput?.kind).toBe("locatedTimestamp");
    if (capturedInput?.kind === "locatedTimestamp") {
      expect(capturedInput.value).toEqual({
        at: "2026-01-01T12:00:00",
        tz: "Europe/Berlin",
        utc: "2026-01-01T11:00:00Z",
      });
    }
  });

  test("reference single combobox maps rows", async () => {
    renderField(
      baseField({
        type: "reference",
        field: "assignee",
        refEntity: "user",
        refLabelField: "name",
        value: "r1",
      }),
      "users",
    );
    await waitFor(() => {
      expect(capturedInput?.kind).toBe("combobox");
      if (capturedInput?.kind === "combobox") {
        expect(capturedInput.options).toEqual([{ value: "r1", label: "Ref One" }]);
      }
    });
  });

  test("reference multiple coerces array value", async () => {
    renderField(
      baseField({
        type: "reference",
        field: "tags",
        refEntity: "tag",
        refMultiple: true,
        value: ["r1"],
      }),
    );
    expect(capturedInput?.kind).toBe("combobox");
    if (capturedInput?.kind === "combobox") {
      expect(capturedInput.multiple).toBe(true);
      expect(capturedInput.value).toEqual(["r1"]);
    }
  });

  test("passes issues and appendix slots to Field", () => {
    renderField(baseField({ type: "text", value: "v" }));
    expect(capturedField?.issues).toEqual([{ field: "f", message: "bad", code: "x" }]);
    expect(capturedField?.labelAppendix).toBeTruthy();
    expect(capturedField?.fieldAppendix).toBeTruthy();
    expect(capturedField?.testId).toBe("field-f");
  });
});



