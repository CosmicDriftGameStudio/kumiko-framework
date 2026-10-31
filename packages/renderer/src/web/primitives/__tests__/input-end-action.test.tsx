import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index.tsx";

const { Input } = defaultPrimitives;
const noop = () => {};

describe("Input endAction", () => {
  test("kind=text: renders an aria-labelled toggle button inside the input wrapper", () => {
    render(
      <Input
        kind="text"
        id="x"
        name="x"
        value=""
        onChange={noop}
        testId="tid"
        endAction={{ icon: <span>mic</span>, ariaLabel: "Dictate", onClick: noop, pressed: true }}
      />,
    );
    const button = screen.getByRole("button", { name: "Dictate" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.parentElement).toBe(screen.getByTestId("tid").parentElement);
    expect(screen.getByTestId("tid-end-action")).toBe(button);
  });

  test("kind=text: click fires onClick without submitting a surrounding form", () => {
    let clicks = 0;
    let submits = 0;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submits += 1;
        }}
      >
        <Input
          kind="text"
          id="x"
          name="x"
          value=""
          onChange={noop}
          endAction={{
            icon: <span>mic</span>,
            ariaLabel: "Dictate",
            onClick: () => {
              clicks += 1;
            },
          }}
        />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
    expect(clicks).toBe(1);
    expect(submits).toBe(0);
  });

  test("kind=text: a labelled end action is a text button that keeps typed text clear of it", () => {
    let clicks = 0;
    render(
      <Input
        kind="text"
        id="x"
        name="x"
        value=""
        onChange={noop}
        testId="tid"
        endAction={{
          label: "Antworten",
          onClick: () => {
            clicks += 1;
          },
        }}
      />,
    );
    const button = screen.getByRole("button", { name: "Antworten" });
    expect(button.textContent).toBe("Antworten");
    expect(screen.getByTestId("tid").className).toContain("pr-28");
    fireEvent.click(button);
    expect(clicks).toBe(1);
  });

  test("kind=text: without endAction no button is rendered", () => {
    render(<Input kind="text" id="x" name="x" value="" onChange={noop} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
