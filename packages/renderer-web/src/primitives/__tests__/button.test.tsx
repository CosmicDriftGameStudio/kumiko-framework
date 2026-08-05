// fw#1831 — ButtonProps.className/ref durchgereicht, damit ein Button auch
// als Drop-Target o.ä. verwendet werden kann.
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
