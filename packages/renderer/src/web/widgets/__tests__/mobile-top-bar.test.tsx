import { describe, expect, mock, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { MobileTopBar } from "../mobile-top-bar.tsx";

describe("MobileTopBar", () => {
  test("list state shows label, chip and actions without a back button", () => {
    render(
      <MobileTopBar
        label="Posteingang · 1 von 5 offen"
        status={{ label: "KI an", tone: "accent" }}
        actions={<button type="button">Menü</button>}
      />,
    );
    expect(screen.getByText("Posteingang · 1 von 5 offen")).toBeTruthy();
    expect(screen.getByText("KI an")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Menü" })).toBeTruthy();
    expect(screen.queryByTestId("mobile-top-bar-back")).toBeNull();
  });

  test("reader state back button is named by its label and fires onClick", () => {
    const onBack = mock(() => {});
    render(<MobileTopBar label="Heizung kalt" back={{ label: "Zur Liste", onClick: onBack }} />);
    fireEvent.click(screen.getByRole("button", { name: "Zur Liste" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("label is not a heading, the screen owns the h1", () => {
    render(<MobileTopBar label="Posteingang" />);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  test("is hidden from md upwards", () => {
    render(<MobileTopBar label="Posteingang" />);
    expect(screen.getByTestId("mobile-top-bar").className).toContain("md:hidden");
  });
});
