import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { DispatcherProvider } from "../../index.ts";
import { defaultPrimitives } from "../primitives/index.tsx";
import { AiTextField } from "../widgets/ai-text-field.tsx";
import {
  BooleanField,
  DateField,
  FileField,
  NumberField,
  RangeField,
  SelectField,
  TextareaField,
  TextField,
} from "../widgets/form-fields.tsx";
import { createMockDispatcher, render } from "./test-utils.tsx";

const { Field } = defaultPrimitives;

describe("DefaultField hideLabel", () => {
  test("hideLabel visually collapses the label to sr-only", () => {
    const view = render(
      <Field id="f1" label="Maps to" hideLabel testId="field">
        <input id="f1" />
      </Field>,
    );
    expect(view.getByText("Maps to").closest("label")?.className).toContain("sr-only");
  });

  test("Label remains linked to the control via htmlFor, even when hidden", () => {
    const view = render(
      <Field id="f1" label="Maps to" hideLabel testId="field">
        <input id="f1" />
      </Field>,
    );
    expect(view.getByLabelText("Maps to")).toBeTruthy();
  });

  test("without hideLabel, the label remains visible (not sr-only)", () => {
    const view = render(
      <Field id="f1" label="Maps to" testId="field">
        <input id="f1" />
      </Field>,
    );
    expect(view.getByText("Maps to").closest("label")?.className).not.toContain("sr-only");
  });

  test("hideLabel also works with layout=inline (BooleanField path)", () => {
    const view = render(
      <Field id="f1" label="Maps to" layout="inline" hideLabel testId="field">
        <input id="f1" type="checkbox" />
      </Field>,
    );
    expect(view.getByText("Maps to").closest("label")?.className).toContain("sr-only");
    expect(view.getByLabelText("Maps to")).toBeTruthy();
  });
});

const LABEL = "Maps to";

// Every *Field widget in form-fields.tsx wires hideLabel through to the
// underlying Field primitive by hand — a widget that forgets
// the pass-through renders a visible label with no compile error, so this
// has to be caught per-widget rather than assumed from the Field test above.
const FIELD_WIDGETS: ReadonlyArray<readonly [string, ReactElement]> = [
  [
    "NumberField",
    <NumberField
      key="NumberField"
      id="f1"
      name="f1"
      label={LABEL}
      value={1}
      onChange={() => {}}
      hideLabel
      testId="field"
    />,
  ],
  [
    "TextField",
    <TextField
      key="TextField"
      id="f1"
      name="f1"
      label={LABEL}
      value="hallo"
      onChange={() => {}}
      hideLabel
      testId="field"
    />,
  ],
  [
    "SelectField",
    <SelectField
      key="SelectField"
      id="f1"
      name="f1"
      label={LABEL}
      value="a"
      onChange={() => {}}
      options={["a", "b"]}
      hideLabel
      testId="field"
    />,
  ],
  [
    "DateField",
    <DateField
      key="DateField"
      id="f1"
      name="f1"
      label={LABEL}
      value="2026-01-01"
      onChange={() => {}}
      hideLabel
      testId="field"
    />,
  ],
  [
    "BooleanField",
    <BooleanField
      key="BooleanField"
      id="f1"
      name="f1"
      label={LABEL}
      value={false}
      onChange={() => {}}
      hideLabel
      testId="field"
    />,
  ],
  [
    "TextareaField",
    <TextareaField
      key="TextareaField"
      id="f1"
      name="f1"
      label={LABEL}
      value="hallo"
      onChange={() => {}}
      hideLabel
      testId="field"
    />,
  ],
  [
    "RangeField",
    <RangeField
      key="RangeField"
      id="f1"
      name="f1"
      label={LABEL}
      value={5}
      onChange={() => {}}
      min={0}
      max={10}
      hideLabel
      testId="field"
    />,
  ],
  [
    "FileField",
    <FileField
      key="FileField"
      id="f1"
      name="f1"
      label={LABEL}
      value={null}
      onChange={() => {}}
      hideLabel
      testId="field"
    />,
  ],
];

describe("form-fields.tsx hideLabel pass-through", () => {
  test.each(FIELD_WIDGETS)(
    "%s collapses its label to sr-only and keeps it htmlFor-linked",
    (_name, element) => {
      const view = render(element);
      expect(view.getByText(LABEL).closest("label")?.className).toContain("sr-only");
      expect(view.getByLabelText(LABEL)).toBeTruthy();
    },
  );
});

// AiTextField builds its own <Field> instead of going through form-fields.tsx
// — a separate widget, so it needs its own pass-through check.
describe("AiTextField hideLabel pass-through", () => {
  test("collapses its label to sr-only and keeps it htmlFor-linked", () => {
    const dispatcher = createMockDispatcher({});
    const view = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <AiTextField
          id="f1"
          name="f1"
          label={LABEL}
          value="hallo"
          onChange={() => {}}
          actions={[]}
          completion={false}
          hideLabel
          testId="field"
        />
      </DispatcherProvider>,
    );
    expect(view.getByText(LABEL).closest("label")?.className).toContain("sr-only");
    expect(view.getByLabelText(LABEL)).toBeTruthy();
  });
});
