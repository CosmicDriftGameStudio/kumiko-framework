import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { StatCard } from "../stat.tsx";
import { StepBar } from "../step-bar.tsx";

describe("StatCard arrow", () => {
  test("a navigable tile pins the arrow to the corner, outside the label row", () => {
    render(<StatCard label="Outstanding since 01.12." value="312" navigable testId="tile" />);
    const arrow = document.querySelector("[data-kumiko-layout='stat-card-arrow']");
    expect(arrow?.getAttribute("class")).toContain("absolute");
    expect(
      screen.getByText("Outstanding since 01.12.").parentElement?.parentElement?.className,
    ).toContain("pr-5");
  });

  test("a plain tile has no arrow", () => {
    render(<StatCard label="Total" value="1" testId="tile" />);
    expect(document.querySelector("[data-kumiko-layout='stat-card-arrow']")).toBeNull();
  });
});

describe("StepBar chain", () => {
  test("the vertical list draws a connector between the markers, none after the last", () => {
    render(
      <StepBar
        steps={["Placed", "Paid", "Shipped"]}
        currentIndex={1}
        compactLabel="Step 2"
        doneSteps={[true, false, false]}
        orientation="stacked"
      />,
    );
    expect(document.querySelectorAll("[data-kumiko-layout='step-chain-connector']")).toHaveLength(
      2,
    );
  });
});
