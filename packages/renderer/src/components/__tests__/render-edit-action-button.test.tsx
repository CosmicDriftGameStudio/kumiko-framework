import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import type { ButtonProps, DialogProps } from "../../primitives";
import { RenderEditActionButton } from "../render-edit-action-button";
import type { RenderEditAction } from "../render-edit-types";

const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId, type, loading }) => (
  <button
    type={type ?? "button"}
    data-testid={testId}
    data-loading={loading ? "1" : "0"}
    onClick={() => {
      void onClick?.();
    }}
  >
    {children}
  </button>
);

const TestDialog: ComponentType<DialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  variant,
  onConfirm,
  testId,
}) =>
  open ? (
    <div data-testid={testId} data-variant={variant ?? "default"}>
      <span data-testid={`${testId}-title`}>{title}</span>
      {description !== undefined && (
        <span data-testid={`${testId}-description`}>{description}</span>
      )}
      <button type="button" data-testid={`${testId}-confirm`} onClick={() => void onConfirm()}>
        {confirmLabel ?? "Confirm"}
      </button>
      <button type="button" data-testid={`${testId}-cancel`} onClick={() => onOpenChange(false)}>
        Cancel
      </button>
    </div>
  ) : null;

function renderAction(action: RenderEditAction, onError: (text: string | null) => void = () => {}) {
  return render(
    <RenderEditActionButton
      action={action}
      Button={TestButton}
      Dialog={TestDialog}
      onError={onError}
    />,
  );
}

describe("RenderEditActionButton", () => {
  test("secondary action without confirm runs onPress immediately", async () => {
    let pressed = 0;
    renderAction({
      id: "ping",
      label: "Ping",
      onPress: async () => {
        pressed += 1;
      },
    });

    expect(rtlScreen.queryByTestId("render-edit-action-ping-dialog")).toBeNull();
    fireEvent.click(rtlScreen.getByTestId("render-edit-action-ping"));
    await waitFor(() => expect(pressed).toBe(1));
  });

  test("explicit confirm text opens dialog; confirm runs onPress, cancel does not", async () => {
    let pressed = 0;
    renderAction({
      id: "archive",
      label: "Archive",
      confirm: "Really archive?",
      confirmLabel: "Yes, archive",
      onPress: async () => {
        pressed += 1;
      },
    });

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-archive"));
    expect(rtlScreen.getByTestId("render-edit-action-archive-dialog")).toBeTruthy();
    expect(rtlScreen.getByTestId("render-edit-action-archive-dialog-description").textContent).toBe(
      "Really archive?",
    );
    expect(rtlScreen.getByTestId("render-edit-action-archive-dialog-confirm").textContent).toBe(
      "Yes, archive",
    );

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-archive-dialog-cancel"));
    expect(rtlScreen.queryByTestId("render-edit-action-archive-dialog")).toBeNull();
    expect(pressed).toBe(0);

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-archive"));
    fireEvent.click(rtlScreen.getByTestId("render-edit-action-archive-dialog-confirm"));
    await waitFor(() => expect(pressed).toBe(1));
  });

  test("danger style forces confirm dialog even without confirm text", async () => {
    let pressed = 0;
    renderAction({
      id: "delete",
      label: "Delete",
      style: "danger",
      onPress: async () => {
        pressed += 1;
      },
    });

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-delete"));
    const dialog = rtlScreen.getByTestId("render-edit-action-delete-dialog");
    expect(dialog.getAttribute("data-variant")).toBe("danger");
    expect(rtlScreen.queryByTestId("render-edit-action-delete-dialog-description")).toBeNull();
    expect(pressed).toBe(0);

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-delete-dialog-confirm"));
    await waitFor(() => expect(pressed).toBe(1));
  });

  test("onPress failure reports via onError", async () => {
    const errors: Array<string | null> = [];
    renderAction(
      {
        id: "boom",
        label: "Boom",
        onPress: async () => {
          throw new Error("action exploded");
        },
      },
      (text) => {
        errors.push(text);
      },
    );

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-boom"));
    await waitFor(() => expect(errors).toContain("action exploded"));
    expect(errors[0]).toBeNull();
  });

  test("sets loading while onPress is in flight", async () => {
    let resolvePress!: () => void;
    const pressPromise = new Promise<void>((resolve) => {
      resolvePress = resolve;
    });
    renderAction({
      id: "slow",
      label: "Slow",
      onPress: () => pressPromise,
    });

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-slow"));
    await waitFor(() =>
      expect(rtlScreen.getByTestId("render-edit-action-slow").getAttribute("data-loading")).toBe(
        "1",
      ),
    );
    resolvePress();
    await waitFor(() =>
      expect(rtlScreen.getByTestId("render-edit-action-slow").getAttribute("data-loading")).toBe(
        "0",
      ),
    );
  });
});
