import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { Input } = defaultPrimitives;
const noop = () => {};

describe("password placeholder", () => {
  test("a declared placeholder reaches the rendered input", () => {
    const { getByPlaceholderText } = render(
      <Input
        kind="password"
        id="pw"
        name="pw"
        value=""
        onChange={noop}
        placeholder="Passwort eingeben"
      />,
    );
    expect(getByPlaceholderText("Passwort eingeben").tagName).toBe("INPUT");
  });

  test("without placeholder the attribute is not set", () => {
    const { container } = render(
      <Input kind="password" id="pw" name="pw" value="" onChange={noop} />,
    );
    const input = container.querySelector("input");
    if (input === null) throw new Error("no input rendered");
    expect(input.hasAttribute("placeholder")).toBe(false);
  });
});
