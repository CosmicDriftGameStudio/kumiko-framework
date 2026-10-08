import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { defaultPrimitives } from "../index.js";

const { Button } = defaultPrimitives;

describe("DefaultButton className/ref (fw#1831)", () => {
  test("merged className landet auf dem DOM-Node", () => {
    render(
      <Button className="my-custom-class" testId="btn">
        Save
      </Button>,
    );
    expect(screen.getByTestId("btn").className).toContain("my-custom-class");
  });

  test("ref landet auf dem <button>-Element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} testId="btn">
        Save
      </Button>,
    );
    expect(ref.current).toBe(screen.getByTestId("btn"));
  });

  test("dataAttributes forwards data-* attributes to the <button>", () => {
    render(
      <Button dataAttributes={{ "data-action": "save" }} testId="btn">
        Save
      </Button>,
    );
    expect(screen.getByTestId("btn").getAttribute("data-action")).toBe("save");
  });
});

describe("DefaultButton icon (fw-ui-defaults)", () => {
  test("icon prop renders the resolved icon left of the text", () => {
    render(
      <Button icon="trash" testId="btn">
        Delete
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.textContent).toBe("Delete");
  });

  test("size='icon' + a resolved icon still renders icon, children and aria-label", () => {
    render(
      <Button icon="trash" size="icon" ariaLabel="Delete" testId="btn">
        Delete
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.textContent).toBe("Delete");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.getAttribute("aria-label")).toBe("Delete");
  });

  test("size='icon' without children renders the icon, accessible name comes from ariaLabel", () => {
    render(<Button icon="trash" size="icon" ariaLabel="Delete" testId="btn" />);
    const btn = screen.getByTestId("btn");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.textContent).toBe("");
    expect(screen.getByRole("button", { name: "Delete" })).toBe(btn);
  });

  test("a button without children needs an icon and an ariaLabel (accessible name)", () => {
    // @ts-expect-error — icon-only without ariaLabel has no accessible name
    const withoutLabel = <Button icon="trash" size="icon" testId="no-label" />;
    // @ts-expect-error — neither children nor icon renders an empty button
    const withoutContent = <Button ariaLabel="Delete" testId="no-content" />;
    expect(withoutLabel.props.testId).toBe("no-label");
    expect(withoutContent.props.testId).toBe("no-content");
  });

  test("unknown icon key: no crash, falls back to rendering children only", () => {
    render(
      // @ts-expect-error — exercising the runtime fallback for a schema-supplied key outside the closed IconKey union
      <Button icon="not-a-real-icon" testId="btn">
        Delete
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.querySelector("svg")).toBeNull();
    expect(btn.textContent).toBe("Delete");
  });
});

describe("DefaultButton secondary variant", () => {
  test("renders surface plus the input-token border, not a grey fill", () => {
    render(
      <Button variant="secondary" testId="btn">
        Cancel
      </Button>,
    );
    const { className } = screen.getByTestId("btn");
    expect(className).toContain("border-input");
    expect(className).toContain("bg-card");
    expect(className).not.toContain("bg-secondary");
  });

  test("ghost variant is primary-coloured text without a border", () => {
    render(
      <Button variant="ghost" testId="btn">
        Save and close
      </Button>,
    );
    expect(screen.getByTestId("btn").className).toContain("text-primary");
  });
});

describe("DefaultButton title and pressed", () => {
  test("title becomes the native tooltip attribute and pressed becomes aria-pressed", () => {
    render(
      <Button title="Mute" pressed testId="btn">
        Mute
      </Button>,
    );
    const button = screen.getByTestId("btn");
    expect(button.getAttribute("title")).toBe("Mute");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  test("pressed={false} still renders aria-pressed=false", () => {
    render(
      <Button pressed={false} testId="btn">
        Mute
      </Button>,
    );
    expect(screen.getByTestId("btn").getAttribute("aria-pressed")).toBe("false");
  });

  test("both attributes are absent when the props are not set", () => {
    render(<Button testId="btn">Mute</Button>);
    const button = screen.getByTestId("btn");
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.hasAttribute("aria-pressed")).toBe(false);
  });
});
