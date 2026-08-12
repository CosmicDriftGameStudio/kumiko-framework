import { describe, expect, test } from "bun:test";
import { DispatcherProvider } from "@cosmicdrift/kumiko-renderer";
import type { ReactElement } from "react";
import { defaultPrimitives } from "../primitives";
import { AiTextField } from "../widgets/ai-text-field";
import {
  BooleanField,
  DateField,
  FileField,
  NumberField,
  RangeField,
  SelectField,
  TextareaField,
  TextField,
} from "../widgets/form-fields";
import { createMockDispatcher, render } from "./test-utils";

const { Field } = defaultPrimitives;

describe("DefaultField hideLabel (fw#1870)", () => {
  test("hideLabel kollabiert das Label visuell zu sr-only", () => {
    const view = render(
      <Field id="f1" label="Maps to" hideLabel testId="field">
        <input id="f1" />
      </Field>,
    );
    expect(view.getByText("Maps to").className).toContain("sr-only");
  });

  test("Label bleibt per htmlFor mit dem Control verknüpft, auch versteckt", () => {
    const view = render(
      <Field id="f1" label="Maps to" hideLabel testId="field">
        <input id="f1" />
      </Field>,
    );
    expect(view.getByLabelText("Maps to")).toBeTruthy();
  });

  test("ohne hideLabel bleibt das Label sichtbar (kein sr-only)", () => {
    const view = render(
      <Field id="f1" label="Maps to" testId="field">
        <input id="f1" />
      </Field>,
    );
    expect(view.getByText("Maps to").className).not.toContain("sr-only");
  });

  test("hideLabel wirkt auch bei layout=inline (BooleanField-Pfad)", () => {
    const view = render(
      <Field id="f1" label="Maps to" layout="inline" hideLabel testId="field">
        <input id="f1" type="checkbox" />
      </Field>,
    );
    expect(view.getByText("Maps to").className).toContain("sr-only");
    expect(view.getByLabelText("Maps to")).toBeTruthy();
  });
});

const LABEL = "Maps to";

// Every *Field widget in form-fields.tsx wires hideLabel through to the
// underlying Field primitive by hand (fw#1870/#1871) — a widget that forgets
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

describe("form-fields.tsx hideLabel pass-through (fw#1870/#1871)", () => {
  test.each(FIELD_WIDGETS)(
    "%s collapses its label to sr-only and keeps it htmlFor-linked",
    (_name, element) => {
      const view = render(element);
      expect(view.getByText(LABEL).className).toContain("sr-only");
      expect(view.getByLabelText(LABEL)).toBeTruthy();
    },
  );
});

// AiTextField builds its own <Field> instead of going through form-fields.tsx
// (fw#1871#1) — a separate widget, so it needs its own pass-through check.
describe("AiTextField hideLabel pass-through (fw#1871#1)", () => {
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
    expect(view.getByText(LABEL).className).toContain("sr-only");
    expect(view.getByLabelText(LABEL)).toBeTruthy();
  });
});
