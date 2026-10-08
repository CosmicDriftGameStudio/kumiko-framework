import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.js";
import { render } from "./test-utils.js";

const { Field, Input } = defaultPrimitives;

describe("DefaultField description", () => {
  test("links the control to the description via aria-describedby", () => {
    const view = render(
      <Field id="note" label="Note" description="What changed and why (optional)" testId="field">
        <Input id="note" name="note" kind="text" value="" onChange={() => {}} />
      </Field>,
    );
    const input = view.getByLabelText("Note");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(view.getByText("What changed and why (optional)").id).toBe(describedBy ?? "");
  });

  test("sets no aria-describedby without a description", () => {
    const view = render(
      <Field id="note" label="Note" testId="field">
        <Input id="note" name="note" kind="text" value="" onChange={() => {}} />
      </Field>,
    );
    expect(view.getByLabelText("Note").hasAttribute("aria-describedby")).toBe(false);
  });

  test("a nested Field without description does not inherit the outer description id", () => {
    const view = render(
      <Field id="outer" label="Outer" description="Outer help">
        <Field id="inner" label="Inner">
          <Input id="inner" name="inner" kind="text" value="" onChange={() => {}} />
        </Field>
      </Field>,
    );
    expect(view.getByLabelText("Inner").hasAttribute("aria-describedby")).toBe(false);
  });

  test("row layout also exposes the description id", () => {
    const view = render(
      <Field id="note" label="Note" layout="row" description="Row help">
        <Input id="note" name="note" kind="text" value="" onChange={() => {}} />
      </Field>,
    );
    expect(view.getByLabelText("Note").getAttribute("aria-describedby")).toBe(
      view.getByText("Row help").id,
    );
  });
});
