// fw#2548: secretMint mints a one-time secret from a write-handler's own
// success payload. This renders the real path (KumikoScreen → SecretMintBody
// → RenderEdit) under a stub dispatcher, proving: (1) the secret is absent
// before submit, (2) only the whitelisted reveal.fields survive the submit —
// a stray "id" in the payload never leaks, (3) confirming clears the reveal
// from the DOM, (4) no query call ever runs that could reload the secret.

import { describe, expect, test } from "bun:test";
import type {
  SecretMintScreenDefinition,
  TextFieldDef,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type BannerProps,
  type CorePrimitives,
  PrimitivesProvider,
  type SectionProps,
  type TextProps,
} from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import { NavProvider } from "../nav";

const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
const noop = () => null;

const testButton: ComponentType<{
  children?: ReactNode;
  onClick?: () => void;
  testId?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}> = ({ children, onClick, testId, type, disabled }) => (
  <button type={type ?? "button"} data-testid={testId} onClick={onClick} disabled={disabled}>
    {children}
  </button>
);

const testForm: ComponentType<{
  children?: ReactNode;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  onSubmit?: () => void;
}> = ({ children, actions, secondaryActions, onSubmit }) => (
  <form
    onSubmit={(e) => {
      e.preventDefault();
      onSubmit?.();
    }}
  >
    {children}
    {secondaryActions}
    {actions}
  </form>
);

const testInput: ComponentType<{
  name?: string;
  value?: unknown;
  onChange?: (v: unknown) => void;
}> = ({ name = "field", value, onChange }) => (
  <input
    aria-label={name}
    data-testid={`input-${name}`}
    value={typeof value === "string" ? value : ""}
    onChange={(e) => onChange?.(e.target.value)}
  />
);

const testSection: ComponentType<SectionProps> = ({ testId, children }) => (
  <div data-testid={testId}>{children}</div>
);
const testBanner: ComponentType<BannerProps> = ({ children, testId }) => (
  <div data-testid={testId}>{children}</div>
);
const testText: ComponentType<TextProps> = ({ children, testId }) => (
  <span data-testid={testId}>{children}</span>
);

const testPrimitives: CorePrimitives = {
  Button: testButton,
  Banner: testBanner,
  Field: passChildren,
  Input: testInput,
  DataTable: noop,
  Form: testForm,
  Section: testSection,
  Card: passChildren,
  Grid: passChildren,
  GridCell: passChildren,
  Text: testText,
  Heading: passChildren,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
} as unknown as CorePrimitives;

const mintScreen: SecretMintScreenDefinition = {
  id: "mint-token",
  type: "secretMint",
  handler: "shop:write:token:mint",
  fields: { label: { type: "text" } as TextFieldDef },
  layout: { sections: [{ title: "Mint", fields: ["label"] }] },
  reveal: { fields: [{ field: "token", label: "Token" }] },
};

function buildSchema(screen: SecretMintScreenDefinition): FeatureSchema {
  return {
    featureName: "shop",
    entities: {},
    screens: [screen],
  } as FeatureSchema;
}

function stubDispatcher(writeData: unknown): {
  dispatcher: Dispatcher;
  queryCalls: unknown[];
} {
  const queryCalls: unknown[] = [];
  const dispatcher: Dispatcher = {
    write: (async () => ({ isSuccess: true, data: writeData })) as unknown as Dispatcher["write"],
    query: (async (type: string, payload: unknown) => {
      queryCalls.push({ type, payload });
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
  return { dispatcher, queryCalls };
}

function renderMintScreen(dispatcher: Dispatcher) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <NavProvider
          value={{
            route: { screenId: "shop:screen:mint-token" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={buildSchema(mintScreen)} qn="shop:screen:mint-token" />
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("SecretMintBody (fw#2548)", () => {
  test("before submit: the secret is not in the DOM", () => {
    const { dispatcher } = stubDispatcher({ token: "kpat_secret", id: "x" });
    renderMintScreen(dispatcher);
    expect(rtlScreen.queryByText("kpat_secret")).toBeNull();
  });

  test("after a successful submit: only the whitelisted reveal field appears — not the payload's other fields", async () => {
    const { dispatcher } = stubDispatcher({ token: "kpat_secret", id: "x" });
    renderMintScreen(dispatcher);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());
    expect(rtlScreen.queryByText("x")).toBeNull();
  });

  test("confirming the reveal clears the secret from the DOM", async () => {
    const { dispatcher } = stubDispatcher({ token: "kpat_secret", id: "x" });
    renderMintScreen(dispatcher);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    fireEvent.click(rtlScreen.getByTestId("kumiko-screen-secret-mint-confirm"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).toBeNull());
  });

  test("the secret is never fetched via a query — it only ever comes from the write result", async () => {
    const { dispatcher, queryCalls } = stubDispatcher({ token: "kpat_secret", id: "x" });
    renderMintScreen(dispatcher);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    expect(queryCalls.length).toBe(0);
  });
});
