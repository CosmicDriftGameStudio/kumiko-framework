import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { Input } = defaultPrimitives;
const noop = () => {};

describe("Input dataAttributes forwarding", () => {
  test("kind=text: data-* lands on the <input>", () => {
    render(
      <Input
        kind="text"
        id="x"
        name="x"
        value=""
        onChange={noop}
        testId="tid"
        dataAttributes={{ "data-1p-ignore": "true" }}
      />,
    );
    expect(screen.getByTestId("tid").getAttribute("data-1p-ignore")).toBe("true");
  });

  test("kind=textarea: data-* lands on the <textarea>", () => {
    const { container } = render(
      <Input
        kind="textarea"
        id="notes"
        name="notes"
        value=""
        onChange={noop}
        dataAttributes={{ "data-testid": "notes-area" }}
      />,
    );
    const textarea = container.querySelector("textarea");
    expect(textarea?.getAttribute("data-testid")).toBe("notes-area");
  });

  test("kind=text without dataAttributes: no extra attributes, unchanged default rendering", () => {
    render(<Input kind="text" id="x" name="x" value="" onChange={noop} testId="tid" />);
    const input = screen.getByTestId("tid");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("data-1p-ignore")).toBeNull();
  });
});
