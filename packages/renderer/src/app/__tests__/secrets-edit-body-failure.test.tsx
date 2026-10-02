// A transport failure makes dispatcher.batch/write reject (server errors
// return { isSuccess: false } instead). The form must leave its submitting
// state and surface an error rather than lock up silently.

import { describe, expect, test } from "bun:test";
import type { SecretsEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import { type CorePrimitives, PrimitivesProvider } from "../../primitives.js";
import { SecretsEditBody } from "../secrets-edit-body.js";

const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives = {
  Banner: ({ children, testId }: { children?: ReactNode; testId?: string }) => (
    <div data-testid={testId}>{children}</div>
  ),
  Button: ({
    children,
    onClick,
    testId,
    type,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    testId?: string;
    type?: "button" | "submit";
    disabled?: boolean;
  }) => (
    <button type={type ?? "button"} data-testid={testId} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Form: ({
    children,
    actions,
    onSubmit,
  }: {
    children?: ReactNode;
    actions?: ReactNode;
    onSubmit?: () => void;
  }) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      {children}
      {actions}
    </form>
  ),
  Section: passChildren,
  Field: ({ children, appendix }: { children?: ReactNode; appendix?: ReactNode }) => (
    <div>
      {children}
      {appendix}
    </div>
  ),
  Input: ({
    testId,
    value,
    onChange,
    disabled,
  }: {
    testId?: string;
    value?: string;
    onChange?: (v: string) => void;
    disabled?: boolean;
  }) => (
    <input
      data-testid={testId}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
  Text: passChildren,
  Grid: passChildren,
  Dialog: () => null,
} as unknown as CorePrimitives;

const screenDef: SecretsEditScreenDefinition = {
  id: "secrets",
  type: "secretsEdit",
  secretKeys: { apiKey: "shop:secret:api-key" },
  fieldLabels: { apiKey: "API key" },
  sections: [{ fields: ["apiKey"] }],
} as unknown as SecretsEditScreenDefinition;

function rejectingDispatcher(): Dispatcher {
  const reject = async (): Promise<never> => {
    throw new Error("network down");
  };
  return {
    write: reject as unknown as Dispatcher["write"],
    batch: reject as unknown as Dispatcher["batch"],
    query: (async () => ({ isSuccess: true, data: [] })) as unknown as Dispatcher["query"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

describe("SecretsEditBody transport failure", () => {
  test("a rejecting batch shows an error, re-enables the form and keeps the drafts", async () => {
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={rejectingDispatcher()}>
          <PrimitivesProvider value={testPrimitives}>
            <SecretsEditBody screen={screenDef} />
          </PrimitivesProvider>
        </DispatcherProvider>
      </LocaleProvider>,
    );

    const input = (await rtlScreen.findByTestId("secret-input-apiKey")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-123" } });
    fireEvent.click(rtlScreen.getByTestId("secrets-edit-submit"));

    await waitFor(() => expect(rtlScreen.queryByTestId("secrets-edit-error")).not.toBeNull());
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("sk-123");
  });
});
