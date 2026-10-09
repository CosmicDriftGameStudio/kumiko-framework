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
import { TENANT_CURRENCY_CONFIG_KEY } from "@cosmicdrift/kumiko-types/fields";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  type TranslationsByLocale,
} from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import { PageHeaderSlotAvailableProvider } from "../../page-header-slot.js";
import {
  type BannerProps,
  type CardProps,
  type CorePrimitives,
  type PageHeaderProps,
  PrimitivesProvider,
  type SecretRevealProps,
  type SectionProps,
  type TextProps,
} from "../../primitives.js";
import type { FeatureSchema } from "../feature-schema.js";
import { KumikoScreen } from "../kumiko-screen.js";
import { NavProvider, type NavTarget } from "../nav.js";

const cardOptionsSeen: Array<CardProps["options"]> = [];

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
  kind?: string;
  name?: string;
  value?: unknown;
  autoComplete?: string;
  onChange?: (v: unknown) => void;
}> = ({ kind, name = "field", value, autoComplete, onChange }) =>
  kind === "boolean" ? (
    <input
      type="checkbox"
      aria-label={name}
      data-testid={`input-${name}`}
      checked={value === true}
      onChange={(e) => onChange?.(e.target.checked)}
    />
  ) : (
    <input
      aria-label={name}
      data-testid={`input-${name}`}
      value={typeof value === "string" ? value : ""}
      autoComplete={autoComplete}
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

const testPageHeader: ComponentType<PageHeaderProps> = ({ title }) => (
  <div data-testid="test-page-header-title">{title}</div>
);

const testPrimitives: CorePrimitives = {
  Button: testButton,
  Banner: testBanner,
  Field: passChildren,
  Input: testInput,
  DataTable: noop,
  Form: testForm,
  Section: testSection,
  Card: ({ children, options }: CardProps) => {
    cardOptionsSeen.push(options);
    return children;
  },
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
  shellHeader?: { readonly translations: TranslationsByLocale },
) {
  const qn = `shop:screen:${screen.id}`;
  const primitives =
    shellHeader !== undefined ? { ...testPrimitives, PageHeader: testPageHeader } : testPrimitives;
  const screenBody = <KumikoScreen schema={buildSchema(screen)} qn={qn} />;
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[shellHeader?.translations ?? {}, kumikoDefaultTranslations]}
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
          <PrimitivesProvider value={primitives}>
            {shellHeader !== undefined ? (
              <PageHeaderSlotAvailableProvider value={true}>
                {screenBody}
              </PageHeaderSlotAvailableProvider>
            ) : (
              screenBody
            )}
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

  test("the reveal and done phases render as the screen body, not as a raw card", async () => {
    cardOptionsSeen.length = 0;
    const { dispatcher } = stubDispatcher({ token: "kpat_secret", id: "x" });
    renderMintScreen(dispatcher);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());
    expect(cardOptionsSeen.at(-1)).toEqual({ screenBody: true });

    cardOptionsSeen.length = 0;
    fireEvent.click(rtlScreen.getByTestId("kumiko-screen-secret-mint-confirm"));
    await waitFor(() =>
      expect(rtlScreen.queryByTestId("kumiko-screen-secret-mint-done")).not.toBeNull(),
    );
    expect(cardOptionsSeen.at(-1)).toEqual({ screenBody: true });
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

describe("SecretMintBody tenant-declared money currency (fw#2933)", () => {
  const moneyMintScreen: SecretMintScreenDefinition = {
    id: "mint-token",
    type: "secretMint",
    handler: "shop:write:token:mint",
    fields: {
      limit: { type: "money", currency: { kind: "tenant" } } as unknown as TextFieldDef,
    },
    layout: { sections: [{ title: "Mint", fields: ["limit"] }] },
    reveal: { fields: [{ field: "token", label: "Token" }] },
  };

  test("holds the mint form until the tenant currency landed, then renders it", async () => {
    let releaseConfig: (() => void) | undefined;
    const configLanded = new Promise<void>((resolve) => {
      releaseConfig = resolve;
    });
    const { dispatcher: base } = stubDispatcher({ token: "kpat_secret" });
    const dispatcher: Dispatcher = {
      ...base,
      query: (async () => {
        await configLanded;
        return {
          isSuccess: true,
          data: { [TENANT_CURRENCY_CONFIG_KEY]: { value: "CHF" } },
        };
      }) as unknown as Dispatcher["query"],
    };
    renderMintScreen(dispatcher, moneyMintScreen);

    expect(rtlScreen.queryByTestId("kumiko-screen-loading")).not.toBeNull();
    expect(rtlScreen.queryByTestId("render-edit-submit")).toBeNull();

    releaseConfig?.();
    await waitFor(() => expect(rtlScreen.queryByTestId("render-edit-submit")).not.toBeNull());
  });
});

describe("SecretMintBody missing reveal fields", () => {
  test("a write result without any declared reveal field shows an error instead of an empty reveal card", async () => {
    const { dispatcher } = stubDispatcher({ id: "x" });
    const loggedErrors: unknown[][] = [];
    // biome-ignore lint/suspicious/noConsole: capturing the logged diagnostic
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      loggedErrors.push(args);
    };
    try {
      renderMintScreen(dispatcher);
      fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
      fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

      await waitFor(() =>
        expect(rtlScreen.queryByTestId("kumiko-screen-secret-mint-missing")).not.toBeNull(),
      );
    } finally {
      console.error = originalConsoleError;
    }
    expect(rtlScreen.queryByTestId("kumiko-screen-secret-mint-card")).toBeNull();
    expect(rtlScreen.queryByTestId("render-edit-submit")).toBeNull();
    expect(String(loggedErrors[0]?.[0])).toContain("token");
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

  // The submit is disabled until the code is entered; wait for it to enable before clicking.
  async function enterConfirmCodeAndSubmit(code: string): Promise<void> {
    fireEvent.change(rtlScreen.getByLabelText(/code/i), { target: { value: code } });
    await waitFor(() =>
      expect(rtlScreen.getByTestId<HTMLButtonElement>("render-edit-submit").disabled).toBe(false),
    );
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
  }

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

    await enterConfirmCodeAndSubmit("123456");

    await waitFor(() =>
      expect(writeCalls.some((c) => c.command === "shop:write:token:confirm")).toBe(true),
    );
    const confirmCall = writeCalls.find((c) => c.command === "shop:write:token:confirm");
    expect(confirmCall?.payload).toEqual({ code: "123456", setupToken: "stok_123" });
  });

  test("the confirm submit stays disabled until the code is entered; a click before that dispatches nothing", async () => {
    const { dispatcher, writeCalls } = stubMultiWriteDispatcher({
      "shop:write:token:mint": { token: "kpat_secret", id: "x", setupToken: "stok_123" },
      "shop:write:token:confirm": {},
    });
    renderMintScreen(dispatcher, mintScreenWithConfirm);
    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    const submit = rtlScreen.getByTestId<HTMLButtonElement>("render-edit-submit");
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(writeCalls.map((c) => c.command)).toEqual(["shop:write:token:mint"]);

    await enterConfirmCodeAndSubmit("123456");
    await waitFor(() =>
      expect(writeCalls.map((c) => c.command)).toEqual([
        "shop:write:token:mint",
        "shop:write:token:confirm",
      ]),
    );
  });

  describe("shell title of the confirm form", () => {
    async function revealWithConfirm(translations: TranslationsByLocale): Promise<void> {
      const { dispatcher } = stubMultiWriteDispatcher({
        "shop:write:token:mint": { token: "kpat_secret", setupToken: "stok_123" },
      });
      renderMintScreen(dispatcher, mintScreenWithConfirm, () => {}, { translations });
      fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
      fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
      await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());
    }

    test("resolves the parent screen's translated title, not the synthetic confirm id", async () => {
      await revealWithConfirm({ "en-US": { "screen:mint-token.title": "Mint a token" } });

      expect(rtlScreen.getByTestId("test-page-header-title").textContent).toBe("Mint a token");
      expect(document.body.textContent).not.toContain(":confirm");
    });

    test("without a translation it falls back to the parent screen id", async () => {
      await revealWithConfirm({});

      expect(rtlScreen.getByTestId("test-page-header-title").textContent).toBe("mint-token");
      expect(document.body.textContent).not.toContain(":confirm");
    });
  });

  test("the reveal phase is one screen form: reveal content leads the code field, with no nested card", async () => {
    cardOptionsSeen.length = 0;
    const { dispatcher } = stubMultiWriteDispatcher({
      "shop:write:token:mint": { token: "kpat_secret", setupToken: "stok_123" },
    });
    renderMintScreen(dispatcher, mintScreenWithConfirm);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    expect(document.querySelectorAll("form").length).toBe(1);
    const lead = rtlScreen.getByTestId("kumiko-screen-secret-mint-card");
    const codeField = rtlScreen.getByLabelText(/code/i);
    // happy-dom wraps <form> in a proxy, so compare by lookup, not identity or contains().
    const form = codeField.closest("form");
    expect(form).not.toBeNull();
    expect(form?.querySelector("[data-testid=kumiko-screen-secret-mint-card]")).not.toBeNull();
    for (const id of ["kumiko-screen-secret-mint-warning", "kumiko-screen-secret-mint-reveal"]) {
      const part = rtlScreen.getByTestId(id);
      expect(lead.contains(part)).toBe(true);
      expect(part.compareDocumentPosition(codeField) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
        0,
      );
    }
    expect(lead.contains(codeField)).toBe(false);
    expect(cardOptionsSeen.length).toBe(0);
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

    await enterConfirmCodeAndSubmit("123456");

    await waitFor(() =>
      expect(rtlScreen.queryByTestId("kumiko-screen-secret-mint-done")).not.toBeNull(),
    );
    expect(rtlScreen.queryByText("kpat_secret")).toBeNull();
  });

  test("without redirect or cancelTarget, cancelling the confirm step restarts at the mint form and drops the secret", async () => {
    const { dispatcher } = stubMultiWriteDispatcher({
      "shop:write:token:mint": { token: "kpat_secret", id: "x", setupToken: "stok_123" },
    });
    renderMintScreen(dispatcher, mintScreenWithConfirm);

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    fireEvent.click(rtlScreen.getByTestId("render-edit-cancel"));

    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).toBeNull());
    expect(rtlScreen.queryByLabelText(/label/i)).not.toBeNull();
    expect(rtlScreen.queryByTestId("kumiko-screen-secret-mint-done")).toBeNull();
  });

  test("with a cancelTarget, cancelling navigates away and drops the secret from a screen that stays mounted", async () => {
    const { dispatcher } = stubMultiWriteDispatcher({
      "shop:write:token:mint": { token: "kpat_secret", id: "x", setupToken: "stok_123" },
    });
    const navigateCalls: NavTarget[] = [];
    renderMintScreen(
      dispatcher,
      { ...mintScreenWithConfirm, cancelTarget: "token-list" },
      (target) => navigateCalls.push(target),
    );

    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());

    fireEvent.click(rtlScreen.getByTestId("render-edit-cancel"));

    expect(navigateCalls).toEqual([{ screenId: "token-list" }]);
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).toBeNull());
  });
});

describe("SecretMintBody reveal.acknowledge gate", () => {
  const gatedMintScreen: SecretMintScreenDefinition = {
    ...mintScreen,
    reveal: { ...mintScreen.reveal, acknowledge: "I saved it" },
  };
  const gatedConfirmScreen: SecretMintScreenDefinition = {
    ...gatedMintScreen,
    confirm: {
      handler: "shop:write:token:confirm",
      fields: { code: { type: "text", autoComplete: "one-time-code" } as TextFieldDef },
      layout: { sections: [{ title: "Confirm", fields: ["code"] }] },
      carry: ["setupToken"],
    },
  };

  async function mintUntilReveal(screen: SecretMintScreenDefinition, writes: unknown) {
    const { dispatcher, writeCalls } = stubMultiWriteDispatcher({
      "shop:write:token:mint": writes,
      "shop:write:token:confirm": {},
    });
    renderMintScreen(dispatcher, screen);
    fireEvent.change(rtlScreen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(rtlScreen.queryByText("kpat_secret")).not.toBeNull());
    return writeCalls;
  }

  test("the acknowledge button stays disabled until the checkbox is ticked", async () => {
    await mintUntilReveal(gatedMintScreen, { token: "kpat_secret" });

    const button = rtlScreen.getByTestId<HTMLButtonElement>("kumiko-screen-secret-mint-confirm");
    expect(button.disabled).toBe(true);
    fireEvent.click(rtlScreen.getByTestId("input-secret-mint-acknowledge"));
    expect(button.disabled).toBe(false);
  });

  test("the confirm submit is blocked until ticked, and the tick never reaches the payload", async () => {
    const writeCalls = await mintUntilReveal(gatedConfirmScreen, {
      token: "kpat_secret",
      setupToken: "stok_123",
    });

    fireEvent.change(rtlScreen.getByLabelText(/code/i), { target: { value: "123456" } });
    const submit = rtlScreen.getByTestId<HTMLButtonElement>("render-edit-submit");
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(writeCalls.map((c) => c.command)).toEqual(["shop:write:token:mint"]);

    fireEvent.click(rtlScreen.getByTestId("input-secret-mint-acknowledge"));
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(writeCalls.some((c) => c.command === "shop:write:token:confirm")).toBe(true),
    );
    const confirmCall = writeCalls.find((c) => c.command === "shop:write:token:confirm");
    expect(confirmCall?.payload).toEqual({ code: "123456", setupToken: "stok_123" });
  });

  test("a text field's autoComplete reaches the input", async () => {
    await mintUntilReveal(gatedConfirmScreen, { token: "kpat_secret", setupToken: "stok_123" });

    expect(rtlScreen.getByLabelText(/code/i).getAttribute("autocomplete")).toBe("one-time-code");
  });
});
