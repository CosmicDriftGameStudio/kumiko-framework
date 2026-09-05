import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { defaultPrimitives } from "../index";

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

  test("size='icon' + a resolved icon drops the children, keeps an accessible name", () => {
    render(
      <Button icon="trash" size="icon" ariaLabel="Delete" testId="btn">
        Delete
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.textContent).toBe("");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.getAttribute("aria-label")).toBe("Delete");
    expect(btn.getAttribute("title")).toBe("Delete");
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
