import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { Input } = defaultPrimitives;
const noop = () => {};

describe("number placeholder", () => {
  test("a declared placeholder reaches the rendered input", () => {
    const { getByPlaceholderText } = render(
      <Input kind="number" id="qty" name="qty" value="" onChange={noop} placeholder="0" />,
    );
    expect(getByPlaceholderText("0").tagName).toBe("INPUT");
  });

  test("without placeholder the attribute is not set", () => {
    const { container } = render(
      <Input kind="number" id="qty" name="qty" value="" onChange={noop} />,
    );
    const input = container.querySelector("input");
    if (input === null) throw new Error("no input rendered");
    expect(input.hasAttribute("placeholder")).toBe(false);
  });
});
