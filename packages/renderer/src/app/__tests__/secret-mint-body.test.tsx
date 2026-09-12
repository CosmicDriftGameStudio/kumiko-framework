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
  type SecretRevealProps,
  type SectionProps,
  type TextProps,
} from "../../primitives";
import type { FeatureSchema } from "../feature-schema";
import { KumikoScreen } from "../kumiko-screen";
import { NavProvider, type NavTarget } from "../nav";

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
// Renders every value's raw text plus a `data-qr` marker — lets tests assert
// both DOM-leak absence (no query needed to find rendered text) and that
// display: "qr" reaches the primitive as `qr: true`.
const testSecretReveal: ComponentType<SecretRevealProps> = ({ values, testId }) => (
  <div data-testid={testId}>
    {values.map((v) => (
      <div key={v.label} data-testid={`secret-value-${v.label}`} data-qr={String(v.qr === true)}>
        {v.value}
      </div>
    ))}
  </div>
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
  SecretReveal: testSecretReveal,
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

// Keyed stub — one write-response per handler QN, and every write call
// recorded with its full payload — for scenarios with more than one
// write-handler in play (mint + confirm).
function stubMultiWriteDispatcher(responses: Readonly<Record<string, unknown>>): {
  dispatcher: Dispatcher;
  writeCalls: Array<{ readonly command: string; readonly payload: unknown }>;
} {
  const writeCalls: Array<{ readonly command: string; readonly payload: unknown }> = [];
  const dispatcher: Dispatcher = {
    write: (async (command: string, payload: unknown) => {
      writeCalls.push({ command, payload });
      return { isSuccess: true, data: responses[command] ?? {} };
    }) as unknown as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
  return { dispatcher, writeCalls };
}

function renderMintScreen(
  dispatcher: Dispatcher,
  screen: SecretMintScreenDefinition = mintScreen,
  navigate: (target: NavTarget) => void = () => {},
) {
  const qn = `shop:screen:${screen.id}`;
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <NavProvider
          value={{
            route: { screenId: qn },
            navigate,
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <PrimitivesProvider value={testPrimitives}>
            <KumikoScreen schema={buildSchema(screen)} qn={qn} />
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

  test("acknowledging without a confirm step and without a redirect shows the done banner", async () => {
    const { dispatcher } = stubDispatcher({ token: "kpat_secret", id: "x" });
    renderMintScreen(dispatcher);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    fireEvent.click(rtlScreen.getByTestId("kumiko-screen-secret-mint-confirm"));
    await waitFor(() =>
      expect(rtlScreen.queryByTestId("kumiko-screen-secret-mint-done")).not.toBeNull(),
    );
  });

  test("acknowledging with a redirect navigates instead of showing the done banner", async () => {
    const { dispatcher } = stubDispatcher({ token: "kpat_secret", id: "x" });
    const navigateCalls: NavTarget[] = [];
    renderMintScreen(dispatcher, { ...mintScreen, redirect: "after-mint" }, (target) =>
      navigateCalls.push(target),
    );

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    fireEvent.click(rtlScreen.getByTestId("kumiko-screen-secret-mint-confirm"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "after-mint" });
    expect(rtlScreen.queryByTestId("kumiko-screen-secret-mint-done")).toBeNull();
  });

  test("a reveal field with display 'qr' reaches the SecretReveal primitive with qr: true", async () => {
    const qrScreen: SecretMintScreenDefinition = {
      ...mintScreen,
      reveal: { fields: [{ field: "token", label: "Token", display: "qr" }] },
    };
    const { dispatcher } = stubDispatcher({ token: "otpauth://totp/x?secret=ABC", id: "x" });
    renderMintScreen(dispatcher, qrScreen);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() =>
      expect(rtlScreen.getByTestId("secret-value-Token").getAttribute("data-qr")).toBe("true"),
    );
  });

  test("an input-less secretMint (no fields) has an active submit button and dispatches the mint handler on click", async () => {
    const inputLessScreen: SecretMintScreenDefinition = {
      id: "mint-token",
      type: "secretMint",
      handler: "shop:write:token:mint",
      fields: {},
      layout: { sections: [] },
      reveal: { fields: [{ field: "token", label: "Token" }] },
    };
    const { dispatcher, writeCalls } = stubMultiWriteDispatcher({
      "shop:write:token:mint": { token: "kpat_secret" },
    });
    renderMintScreen(dispatcher, inputLessScreen);

    const submit = rtlScreen.getByTestId("render-edit-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());
    expect(writeCalls.map((c) => c.command)).toEqual(["shop:write:token:mint"]);
  });
});

describe("SecretMintBody confirm step (fw#2838)", () => {
  const mintScreenWithConfirm: SecretMintScreenDefinition = {
    ...mintScreen,
    confirm: {
      handler: "shop:write:token:confirm",
      fields: { code: { type: "text" } as TextFieldDef },
      layout: { sections: [{ title: "Confirm", fields: ["code"] }] },
      carry: ["setupToken"],
    },
  };

  test("renders the confirm form instead of the acknowledge button, and submits the confirm form's own values merged with the carried mint-payload field", async () => {
    const { dispatcher, writeCalls } = stubMultiWriteDispatcher({
      "shop:write:token:mint": { token: "kpat_secret", id: "x", setupToken: "stok_123" },
      "shop:write:token:confirm": {},
    });
    renderMintScreen(dispatcher, mintScreenWithConfirm);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    // No bare acknowledge button — the confirm form takes its place.
    expect(rtlScreen.queryByTestId("kumiko-screen-secret-mint-confirm")).toBeNull();

    fireEvent.change(rtlScreen.getByLabelText(/code/i), { target: { value: "123456" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() =>
      expect(writeCalls.some((c) => c.command === "shop:write:token:confirm")).toBe(true),
    );
    const confirmCall = writeCalls.find((c) => c.command === "shop:write:token:confirm");
    expect(confirmCall?.payload).toEqual({ code: "123456", setupToken: "stok_123" });
  });

  test("a carried field that is not in reveal.fields never appears in the DOM", async () => {
    const { dispatcher } = stubMultiWriteDispatcher({
      "shop:write:token:mint": { token: "kpat_secret", id: "x", setupToken: "stok_123" },
    });
    renderMintScreen(dispatcher, mintScreenWithConfirm);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    expect(rtlScreen.queryByText("stok_123")).toBeNull();
  });

  test("without a redirect, a successful confirm shows the done banner", async () => {
    const { dispatcher } = stubMultiWriteDispatcher({
      "shop:write:token:mint": { token: "kpat_secret", id: "x", setupToken: "stok_123" },
      "shop:write:token:confirm": {},
    });
    renderMintScreen(dispatcher, mintScreenWithConfirm);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    fireEvent.change(rtlScreen.getByLabelText(/code/i), { target: { value: "123456" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() =>
      expect(rtlScreen.queryByTestId("kumiko-screen-secret-mint-done")).not.toBeNull(),
    );
    expect(rtlScreen.queryByText("kpat_secret")).toBeNull();
  });
});
