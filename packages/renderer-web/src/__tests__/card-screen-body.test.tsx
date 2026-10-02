import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.js";
import { render, screen } from "./test-utils.js";

const { Card } = defaultPrimitives;

describe("DefaultCard screenBody", () => {
  test("takes the form-screen shell width instead of a frame and card padding", () => {
    render(
      <Card options={{ screenBody: true }} testId="c">
        <span>content</span>
      </Card>,
    );
    const card = screen.getByTestId("c");
    const shell = card.parentElement as HTMLElement;
    expect(shell.className).toContain("max-w-4xl");
    expect(card.className).not.toContain("shadow");
    expect(card.className).not.toContain("border");
  });

  test("without the option the card keeps its frame and sits directly in its parent", () => {
    render(
      <Card testId="c">
        <span>content</span>
      </Card>,
    );
    const card = screen.getByTestId("c");
    expect(card.className).toContain("border");
    expect(card.parentElement?.className ?? "").not.toContain("max-w-4xl");
  });
});
