import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.js";
import { render, screen } from "./test-utils.js";

const { Input, Field } = defaultPrimitives;

const options = [
  { value: "x", label: "X" },
  { value: "y", label: "Y" },
];

describe("select radiogroup accessible name", () => {
  test("inside a labelled Field the group is named by the Field label", () => {
    render(
      <Field id="s" label="Status">
        <Input kind="select" id="s" name="s" value="x" onChange={() => {}} options={options} />
      </Field>,
    );
    const group = screen.getByTestId("segmented-s");
    expect(group.getAttribute("aria-labelledby")).toBe("s-label");
    expect(group.hasAttribute("aria-label")).toBe(false);
  });

  test("without a Field the group falls back to aria-label instead of a dangling aria-labelledby", () => {
    render(
      <Input kind="select" id="s" name="status" value="x" onChange={() => {}} options={options} />,
    );
    const group = screen.getByTestId("segmented-s");
    expect(group.hasAttribute("aria-labelledby")).toBe(false);
    expect(group.getAttribute("aria-label")).toBe("status");
  });

  test("the radio list gets the same fallback", () => {
    render(
      <Input
        kind="select"
        id="s"
        name="plan"
        value="x"
        onChange={() => {}}
        options={options}
        radioVariant="card"
      />,
    );
    const group = screen.getByTestId("radio-list-s");
    expect(group.hasAttribute("aria-labelledby")).toBe(false);
    expect(group.getAttribute("aria-label")).toBe("plan");
  });
});
