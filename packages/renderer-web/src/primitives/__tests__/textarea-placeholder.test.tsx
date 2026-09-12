import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { Input } = defaultPrimitives;
const noop = () => {};

describe("textarea placeholder", () => {
  test("a declared placeholder reaches the rendered textarea", () => {
    const { getByPlaceholderText } = render(
      <Input
        kind="textarea"
        id="notes"
        name="notes"
        value=""
        onChange={noop}
        placeholder="Nachricht an den Agenten …"
      />,
    );
    expect(getByPlaceholderText("Nachricht an den Agenten …").tagName).toBe("TEXTAREA");
  });

  test("without placeholder the attribute is not set", () => {
    const { container } = render(
      <Input kind="textarea" id="notes" name="notes" value="" onChange={noop} />,
    );
    const textarea = container.querySelector("textarea");
    if (textarea === null) throw new Error("no textarea rendered");
    expect(textarea.hasAttribute("placeholder")).toBe(false);
  });
});
