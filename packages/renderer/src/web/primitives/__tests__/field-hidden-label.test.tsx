import { describe, expect, test } from "bun:test";
import { render } from "../../__tests__/test-utils.tsx";
import { defaultPrimitives } from "../index.tsx";

const { Field, Input } = defaultPrimitives;

function fieldWith(hideLabel: boolean) {
  return render(
    <Field id="answer" label="Antwort" testId="field" hideLabel={hideLabel}>
      <Input kind="text" id="answer" name="answer" value="" onChange={() => {}} />
    </Field>,
  );
}

describe("Field with a hidden label", () => {
  // A row holding only the sr-only label would still take the column gap and push the control down,
  // so it no longer lines up with a button beside it.
  test("puts the hidden label straight into the column, without a label row", () => {
    const field = fieldWith(true).getByTestId("field");
    const label = field.querySelector("label");
    expect(label?.parentElement).toBe(field);
    expect(label?.className).toContain("sr-only");
  });

  test("a visible label keeps its row", () => {
    const field = fieldWith(false).getByTestId("field");
    expect(field.querySelector("label")?.parentElement).not.toBe(field);
  });
});
