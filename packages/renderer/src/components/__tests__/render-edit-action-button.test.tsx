import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import type { ButtonProps, DialogProps } from "../../primitives.js";
import { RenderEditActionButton } from "../render-edit-action-button.js";
import type { RenderEditAction } from "../render-edit-types.js";

const TestButton: ComponentType<ButtonProps> = ({
  children,
  onClick,
  testId,
  type,
  loading,
  icon,
  size,
  ariaLabel,
  title,
}) => (
  <button
    type={type ?? "button"}
    data-testid={testId}
    data-icon={icon}
    data-size={size ?? "md"}
    aria-label={ariaLabel}
    title={title}
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
      <button
        type="button"
        data-testid={`${testId}-confirm`}
        onClick={() => {
          void (async () => {
            await onConfirm();
            onOpenChange(false);
          })();
        }}
      >
        {confirmLabel ?? "Confirm"}
      </button>
      <button type="button" data-testid={`${testId}-cancel`} onClick={() => onOpenChange(false)}>
        Cancel
      </button>
    </div>
  ) : null;

function renderAction(
  action: RenderEditAction,
  onError: (text: string | null) => void = () => {},
  extra: { readonly iconOnly?: boolean; readonly hideIcon?: boolean } = {},
) {
  return render(
    <RenderEditActionButton
      action={action}
      {...extra}
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
    await waitFor(() =>
      expect(rtlScreen.queryByTestId("render-edit-action-archive-dialog")).toBeNull(),
    );
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

    expect(rtlScreen.getByTestId("render-edit-action-delete-dialog-confirm").textContent).toBe(
      "Delete",
    );

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-delete-dialog-confirm"));
    await waitFor(() => expect(pressed).toBe(1));
  });

  // schema-driven navigate/drawer actions set confirmRequired: false
  // to opt a danger-styled action out of the forced dialog — the colour still
  // marks it destructive, but the target form is itself the confirmation.
  test("danger style with confirmRequired=false fires onPress directly, no dialog", async () => {
    let pressed = 0;
    renderAction({
      id: "open-terminate-form",
      label: "Terminate",
      style: "danger",
      confirmRequired: false,
      onPress: async () => {
        pressed += 1;
      },
    });

    fireEvent.click(rtlScreen.getByTestId("render-edit-action-open-terminate-form"));
    expect(rtlScreen.queryByTestId("render-edit-action-open-terminate-form-dialog")).toBeNull();
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
    // Cleared at the start of trigger, then set on failure.
    expect(errors[0]).toBeNull();
  });

  describe("icon rendering", () => {
    const iconAction: RenderEditAction = {
      id: "archive",
      label: "Archive",
      icon: "archive",
      onPress: async () => {},
    };

    test("iconOnly with a resolved icon renders an unlabelled icon button with aria-label", () => {
      renderAction(iconAction, () => {}, { iconOnly: true });

      const button = rtlScreen.getByTestId("render-edit-action-archive");
      expect(button.getAttribute("data-size")).toBe("icon");
      expect(button.getAttribute("data-icon")).toBe("archive");
      expect(button.getAttribute("aria-label")).toBe("Archive");
      expect(button.getAttribute("title")).toBe("Archive");
      expect(button.textContent).toBe("");
    });

    test("iconOnly without an icon keeps the text label", () => {
      const { icon: _icon, ...withoutIcon } = iconAction;
      renderAction(withoutIcon, () => {}, { iconOnly: true });

      const button = rtlScreen.getByTestId("render-edit-action-archive");
      expect(button.getAttribute("data-size")).toBe("md");
      expect(button.getAttribute("data-icon")).toBeNull();
      expect(button.textContent).toBe("Archive");
    });

    test("without iconOnly the icon sits next to the label", () => {
      renderAction(iconAction);

      const button = rtlScreen.getByTestId("render-edit-action-archive");
      expect(button.getAttribute("data-icon")).toBe("archive");
      expect(button.textContent).toBe("Archive");
    });

    test("hideIcon drops the icon on text buttons but not when collapsed to icon-only", () => {
      const { unmount } = renderAction(iconAction, () => {}, { hideIcon: true });
      const textButton = rtlScreen.getByTestId("render-edit-action-archive");
      expect(textButton.getAttribute("data-icon")).toBeNull();
      expect(textButton.textContent).toBe("Archive");
      unmount();

      renderAction(iconAction, () => {}, { hideIcon: true, iconOnly: true });
      const iconButton = rtlScreen.getByTestId("render-edit-action-archive");
      expect(iconButton.getAttribute("data-icon")).toBe("archive");
      expect(iconButton.textContent).toBe("");
    });
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
