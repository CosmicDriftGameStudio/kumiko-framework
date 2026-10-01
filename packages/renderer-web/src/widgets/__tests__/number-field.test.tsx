import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils.js";
import { NumberField } from "../form-fields.js";

describe("NumberField grouping", () => {
  test("grouping=false shows a year without a thousands separator", () => {
    render(
      <NumberField
        label="Year"
        id="y"
        name="y"
        value={2021}
        onChange={() => {}}
        grouping={false}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("2021");
  });

  test("grouping defaults to on", () => {
    render(<NumberField label="Count" id="c" name="c" value={2021} onChange={() => {}} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).not.toBe("2021");
  });
});
