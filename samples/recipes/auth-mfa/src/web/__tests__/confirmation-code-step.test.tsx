import { describe, expect, mock, test } from "bun:test";
import { PrimitivesProvider } from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfirmationCodeStep } from "../confirmation-code-step.tsx";

function renderStep(onConfirm: (code: string) => Promise<boolean>): void {
  render(
    <PrimitivesProvider value={defaultPrimitives}>
      <ConfirmationCodeStep onConfirm={onConfirm} />
    </PrimitivesProvider>,
  );
}

function type(value: string): void {
  fireEvent.change(screen.getByTestId("confirmation-code"), { target: { value } });
}

describe("ConfirmationCodeStep", () => {
  test("focuses the input on mount", () => {
    renderStep(async () => true);
    expect(document.activeElement).toBe(screen.getByTestId("confirmation-code"));
  });

  test("does not confirm before six digits", () => {
    const onConfirm = mock(async (_code: string) => true);
    renderStep(onConfirm);
    type("12345");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("pasted '123 456' confirms once with 123456", async () => {
    const onConfirm = mock(async (_code: string) => true);
    renderStep(onConfirm);
    type("123 456");
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith("123456");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a rejected code shows the error, clears the field and refocuses", async () => {
    const onConfirm = mock(async (_code: string) => false);
    renderStep(onConfirm);
    type("123456");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const input = screen.getByTestId("confirmation-code");
    expect(input).toHaveProperty("value", "");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
