import { describe, expect, mock, test } from "bun:test";
import type { ConfigEditAction } from "@cosmicdrift/kumiko-framework/ui-types";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { LocaleProvider } from "../../i18n.tsx";
import {
  type ButtonProps,
  type CorePrimitives,
  type FieldProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import { createMockDispatcher } from "../../web/__tests__/test-utils.tsx";
import { ConfigEditActionRow } from "../config-edit-action-row.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const primitives: CorePrimitives = {
  Button: ({ children, disabled, onClick, testId, title }: ButtonProps) => (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={testId} title={title}>
      {children}
    </button>
  ),
  Banner: ({ children, testId }) => <div data-testid={testId}>{children}</div>,
  Field: ({ label, description, children, testId }: FieldProps) => (
    <div data-testid={testId}>
      <span>{label}</span>
      <span>{description}</span>
      {children}
    </div>
  ),
  Input: noop,
  DataTable: noop,
  Form: passChildren,
  Section: passChildren,
  Card: passChildren,
  Grid: passChildren,
  GridCell: passChildren,
  Text: ({ children, testId }) => <span data-testid={testId}>{children}</span>,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

const action: ConfigEditAction = {
  id: "send-test",
  handler: "contact:write:send-test",
  label: "contact.test.label",
  description: "contact.test.description",
  buttonLabel: "contact.test.button",
  afterField: "telegramChat",
  successMessage: "contact.test.sent",
};

const TEXTS: Readonly<Record<string, string>> = {
  "contact.test.label": "Test message",
  "contact.test.button": "Send test",
  "contact.test.sent": "Test sent",
  "contact.errors.chat": "Chat id missing",
  "kumiko.configEdit.action.saveFirst": "Save first",
};

const resolver = {
  translate: (key: string) => TEXTS[key] ?? key,
  locale: () => "en-US",
  timeZone: () => "UTC",
  subscribe: () => () => {},
};

function renderRow(dirty: boolean, write: (...args: unknown[]) => Promise<unknown>) {
  return render(
    <LocaleProvider resolver={resolver}>
      <DispatcherProvider
        dispatcher={createMockDispatcher({
          write: write as unknown as Dispatcher["write"],
        })}
      >
        <PrimitivesProvider value={primitives}>
          <ConfigEditActionRow action={action} dirty={dirty} />
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("ConfigEditActionRow", () => {
  test("a click calls the handler with an empty payload and shows the success message", async () => {
    const write = mock(async (..._args: unknown[]) => ({ isSuccess: true, data: {} }));
    const view = renderRow(false, write);
    fireEvent.click(view.getByTestId("config-edit-action-send-test-button"));
    await waitFor(() =>
      expect(view.getByTestId("config-edit-action-send-test-outcome").textContent).toBe(
        "Test sent",
      ),
    );
    expect(write.mock.calls).toEqual([["contact:write:send-test", {}]]);
  });

  test("a failing handler shows the translated error text", async () => {
    const write = mock(async (..._args: unknown[]) => ({
      isSuccess: false,
      error: {
        code: "unprocessable",
        httpStatus: 422,
        i18nKey: "contact.errors.chat",
        message: "chat missing",
      },
    }));
    const view = renderRow(false, write);
    fireEvent.click(view.getByTestId("config-edit-action-send-test-button"));
    await waitFor(() =>
      expect(view.getByTestId("config-edit-action-send-test-outcome").textContent).toBe(
        "Chat id missing",
      ),
    );
  });

  test("the button is disabled with a save-first hint while the form is dirty", () => {
    const write = mock(async (..._args: unknown[]) => ({ isSuccess: true, data: {} }));
    const view = renderRow(true, write);
    const button = view.getByTestId("config-edit-action-send-test-button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(view.getByTestId("config-edit-action-send-test-hint").textContent).toBe("Save first");
    fireEvent.click(button);
    expect(write.mock.calls).toHaveLength(0);
  });
});
