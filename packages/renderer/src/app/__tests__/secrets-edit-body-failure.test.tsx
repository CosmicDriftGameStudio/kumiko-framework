// A transport failure makes dispatcher.batch/write reject (server errors
// return { isSuccess: false } instead). The form must leave its submitting
// state and surface an error rather than lock up silently.

import { describe, expect, test } from "bun:test";
import type { SecretsEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { type InputProps, PrimitivesProvider } from "../../primitives.tsx";
import { createMockDispatcher, createStubPrimitives } from "../../testing.ts";
import { SecretsEditBody } from "../secrets-edit-body.tsx";

const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives = createStubPrimitives({
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
  Field: passChildren,
  Input: (props: InputProps) =>
    props.kind === "password" ? (
      <input
        data-testid={props.testId}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      />
    ) : null,
  Text: passChildren,
  Grid: passChildren,
  Dialog: () => null,
});

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
  return createMockDispatcher({
    write: reject,
    batch: reject,
    query: async () => ({ isSuccess: true, data: [] }),
  });
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
