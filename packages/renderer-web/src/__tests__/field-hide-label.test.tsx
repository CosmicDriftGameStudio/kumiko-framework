import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives";
import { render } from "./test-utils";

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
