import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { Icon } from "../icons";

describe("Icon (fw#3056 public export)", () => {
  test("renders the resolved icon in the DOM", () => {
    const { container } = render(<Icon name="trash" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  test("is not focusable", () => {
    const { container } = render(<Icon name="trash" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.hasAttribute("tabindex")).toBe(false);
  });

  test("is marked decorative for screen readers", () => {
    const { container } = render(<Icon name="trash" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("@ts-expect-error: name must be a registered NavIconKey, not any string", () => {
    const { container } = render(
      // @ts-expect-error — "not-a-real-icon" is not a NavIconKey
      <Icon name="not-a-real-icon" />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
