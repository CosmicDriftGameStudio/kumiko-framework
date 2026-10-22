import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "../../__tests__/test-utils.tsx";
import { ChoiceCards } from "../choice-cards.tsx";

const options = [
  { value: "a", title: "Anbieter A", description: "Rechnung von A", aside: "9,00 €" },
  { value: "b", title: "Anbieter B" },
  { value: "c", title: "Anbieter C", disabled: true },
];

describe("ChoiceCards", () => {
  test("checks the selected radio and shares one group name", () => {
    render(<ChoiceCards value="b" options={options} onChange={() => {}} ariaLabel="Wahl" />);
    expect(screen.getByRole("radiogroup", { name: "Wahl" })).toBeTruthy();
    const a = screen.getByRole("radio", { name: /Anbieter A/ }) as HTMLInputElement;
    const b = screen.getByRole("radio", { name: /Anbieter B/ }) as HTMLInputElement;
    expect(a.checked).toBe(false);
    expect(b.checked).toBe(true);
    expect(a.name).toBe(b.name);
    expect(screen.getByText("Rechnung von A")).toBeTruthy();
    expect(screen.getByText("9,00 €")).toBeTruthy();
  });

  test("selecting another card fires onChange with its value", () => {
    const onChange = mock((_value: string) => {});
    render(<ChoiceCards value="a" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Anbieter B/ }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  test("a disabled option cannot be selected", () => {
    const onChange = mock((_value: string) => {});
    render(<ChoiceCards value="a" options={options} onChange={onChange} />);
    const c = screen.getByRole("radio", { name: /Anbieter C/ }) as HTMLInputElement;
    expect(c.disabled).toBe(true);
    fireEvent.click(c);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("the selected card carries the primary border", () => {
    render(<ChoiceCards value="a" options={options} onChange={() => {}} testId="cards" />);
    expect(screen.getByTestId("cards-a").className).toContain("border-primary");
    expect(screen.getByTestId("cards-b").className).not.toContain("border-primary");
  });
});
