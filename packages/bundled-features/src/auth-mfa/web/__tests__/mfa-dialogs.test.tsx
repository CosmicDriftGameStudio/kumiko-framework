import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement, type ReactNode, useState } from "react";
import { defaultTranslations } from "../i18n.ts";
import { MfaDisableDialog } from "../mfa-disable-dialog.tsx";
import { MfaRegenerateRecoveryDialog } from "../mfa-regenerate-recovery-dialog.tsx";

type WriteCall = { readonly type: string; readonly payload: unknown };

function makeDispatcher(calls: WriteCall[]): Dispatcher {
  return {
    write: async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return { isSuccess: true, data: { disabled: true, recoveryCodes: [] } };
    },
  } as unknown as Dispatcher;
}

function renderWith(ui: ReactElement, dispatcher: Dispatcher): void {
  render(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en" })}
        fallbackBundles={[defaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>{ui}</DispatcherProvider>
      </LocaleProvider>
    </PrimitivesProvider>,
  );
}

describe("MfaDisableDialog", () => {
  test("Six digits do not trigger auto-submit; Confirm sends the code", async () => {
    const calls: WriteCall[] = [];
    renderWith(
      <MfaDisableDialog open onOpenChange={() => {}} onDisabled={() => {}} onError={() => {}} />,
      makeDispatcher(calls),
    );

    const input = screen.getByLabelText(/^Code from your authenticator app/);
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "123456" } });
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.payload).toEqual({ code: "123456" });
  });

  test("Toggle switches to a recovery-code text field and back", () => {
    renderWith(
      <MfaDisableDialog open onOpenChange={() => {}} onDisabled={() => {}} onError={() => {}} />,
      makeDispatcher([]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    const recovery = screen.getByLabelText(/^Recovery code/);
    expect(document.activeElement).toBe(recovery);
    fireEvent.change(recovery, { target: { value: "abcd-efgh" } });
    expect(recovery).toHaveProperty("value", "abcd-efgh");

    fireEvent.click(screen.getByRole("button", { name: "Use the code from your app" }));
    expect(screen.getByLabelText(/^Code from your authenticator app/)).toHaveProperty("value", "");
  });
});

function ReopenableDisableDialog(): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
      <MfaDisableDialog
        open={open}
        onOpenChange={setOpen}
        onDisabled={() => {}}
        onError={() => {}}
      />
    </>
  );
}

describe("MfaDisableDialog reopening", () => {
  test("After Cancel and reopening, code mode is active", async () => {
    renderWith(<ReopenableDisableDialog />, makeDispatcher([]));

    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    expect(screen.getByLabelText(/^Recovery code/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));

    expect(screen.getByLabelText(/^Code from your authenticator app/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Recovery code/)).toBeNull();
  });
});

describe("MfaRegenerateRecoveryDialog", () => {
  test("Toggle: recovery code is sent unchanged", async () => {
    const calls: WriteCall[] = [];
    renderWith(
      <MfaRegenerateRecoveryDialog
        open
        onOpenChange={() => {}}
        onRegenerated={() => {}}
        onError={() => {}}
      />,
      makeDispatcher(calls),
    );

    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    fireEvent.change(screen.getByLabelText(/^Recovery code/), { target: { value: "ABCD-EFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate new codes" }));

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.payload).toEqual({ code: "ABCD-EFGH" });
  });

  test("Code field is focused and sends only after confirming", async () => {
    const calls: WriteCall[] = [];
    renderWith(
      <MfaRegenerateRecoveryDialog
        open
        onOpenChange={() => {}}
        onRegenerated={() => {}}
        onError={() => {}}
      />,
      makeDispatcher(calls),
    );

    const input = screen.getByLabelText(/^Code from your authenticator app/);
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "123456" } });
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Generate new codes" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.payload).toEqual({ code: "123456" });
  });
});
