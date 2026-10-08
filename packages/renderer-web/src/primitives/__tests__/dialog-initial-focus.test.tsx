import { describe, expect, test } from "bun:test";
import { createStaticLocaleResolver, LocaleProvider } from "@cosmicdrift/kumiko-renderer";
import { render, screen, waitFor } from "@testing-library/react";
import { defaultPrimitives } from "../index.js";

const { Dialog } = defaultPrimitives;

function renderDialog(variant: "default" | "danger"): void {
  render(
    <LocaleProvider resolver={createStaticLocaleResolver()}>
      <Dialog
        open
        onOpenChange={() => {}}
        title="Confirm"
        variant={variant}
        onConfirm={() => {}}
        testId="d"
      />
    </LocaleProvider>,
  );
}

describe("Dialog initial focus", () => {
  test("a danger dialog focuses Cancel, so Enter does not run the destructive action", async () => {
    renderDialog("danger");

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("d-cancel")));
  });

  test("a default dialog focuses Confirm", async () => {
    renderDialog("default");

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("d-confirm")));
  });
});
