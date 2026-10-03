// Fixed secret keys the viewer cannot write (writeRoles) are hidden, not
// read-only; the server write gate stays authoritative.

import { describe, expect, test } from "bun:test";
import type { SecretsEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { UserRolesProvider } from "../../context/user-roles-context.js";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import { type CorePrimitives, PrimitivesProvider } from "../../primitives.js";
import { SecretsEditBody } from "../secrets-edit-body.js";

const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives = {
  Banner: passChildren,
  Button: ({
    children,
    onClick,
    testId,
    type,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    testId?: string;
    type?: "button" | "submit";
  }) => (
    <button type={type ?? "button"} data-testid={testId} onClick={onClick}>
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
  Section: ({ children, title }: { children?: ReactNode; title?: string }) => (
    <section data-testid={`section-${title}`}>{children}</section>
  ),
  Field: passChildren,
  Input: ({
    testId,
    value,
    onChange,
  }: {
    testId?: string;
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <input data-testid={testId} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)} />
  ),
  Text: passChildren,
  Grid: passChildren,
  Dialog: () => null,
} as unknown as CorePrimitives;

const screenDef: SecretsEditScreenDefinition = {
  id: "secrets",
  type: "secretsEdit",
  secretKeys: {
    "stripe-api-key": "stripe:secret:api-key",
    "stripe-open": "stripe:secret:open",
    "mailer-password": "mailer:secret:password",
  },
  fieldLabels: {
    "stripe-api-key": "Stripe key",
    "stripe-open": "Stripe open",
    "mailer-password": "Mailer password",
  },
  fieldAccess: {
    "stripe-api-key": { roles: ["SystemAdmin"] },
    "mailer-password": { roles: ["SystemAdmin"] },
  },
  sections: [
    { title: "stripe.settings", fields: ["stripe-api-key", "stripe-open"] },
    { title: "mailer.settings", fields: ["mailer-password"] },
  ],
};

function recordingDispatcher(batches: unknown[][]): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: null })) as unknown as Dispatcher["write"],
    batch: (async (commands: unknown[]) => {
      batches.push(commands);
      return { isSuccess: true, data: [] };
    }) as unknown as Dispatcher["batch"],
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

function renderBody(roles: readonly string[] | undefined, batches: unknown[][] = []): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={recordingDispatcher(batches)}>
        <UserRolesProvider roles={roles}>
          <PrimitivesProvider value={testPrimitives}>
            <SecretsEditBody screen={screenDef} />
          </PrimitivesProvider>
        </UserRolesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("SecretsEditBody writeRoles visibility", () => {
  test("a viewer without the write role sees only ungated fields", async () => {
    renderBody(["TenantAdmin"]);

    await rtlScreen.findByTestId("secret-input-stripe-open");
    expect(rtlScreen.queryByTestId("secret-input-stripe-api-key")).toBeNull();
    expect(rtlScreen.queryByTestId("secret-input-mailer-password")).toBeNull();
  });

  test("a viewer with the write role sees the gated fields", async () => {
    renderBody(["SystemAdmin"]);

    await rtlScreen.findByTestId("secret-input-stripe-open");
    expect(rtlScreen.queryByTestId("secret-input-stripe-api-key")).not.toBeNull();
    expect(rtlScreen.queryByTestId("secret-input-mailer-password")).not.toBeNull();
  });

  test("unknown roles hide gated fields but keep ungated ones", async () => {
    renderBody(undefined);

    await rtlScreen.findByTestId("secret-input-stripe-open");
    expect(rtlScreen.queryByTestId("secret-input-stripe-api-key")).toBeNull();
  });

  test("a section whose fields are all hidden is not rendered", async () => {
    renderBody(["TenantAdmin"]);

    await rtlScreen.findByTestId("secret-input-stripe-open");
    expect(rtlScreen.queryByTestId("section-mailer.settings")).toBeNull();
    expect(rtlScreen.queryByTestId("section-stripe.settings")).not.toBeNull();
  });

  test("submit sends set commands only for visible fields", async () => {
    const batches: unknown[][] = [];
    renderBody(["TenantAdmin"], batches);

    const input = await rtlScreen.findByTestId("secret-input-stripe-open");
    fireEvent.change(input, { target: { value: "sk-open" } });
    fireEvent.click(rtlScreen.getByTestId("secrets-edit-submit"));

    await waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]).toEqual([
      { type: "secrets:write:set", payload: { key: "stripe:secret:open", value: "sk-open" } },
    ]);
  });
});
