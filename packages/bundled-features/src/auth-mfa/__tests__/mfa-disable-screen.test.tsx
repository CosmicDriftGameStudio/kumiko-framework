// The disable form as the browser runs it: after the handler accepts the code
// the user sees a confirmation and an empty code field instead of the unchanged form.

import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  type FeatureSchema,
  KumikoScreen,
  kumikoDefaultTranslations,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  NavProvider,
  PrimitivesProvider,
  TokensProvider,
} from "@cosmicdrift/kumiko-renderer";
import {
  createStore,
  type Dispatcher,
  type DispatcherError,
  type DispatcherStatus,
} from "@cosmicdrift/kumiko-renderer/headless";
import { defaultPrimitives, defaultTokens } from "@cosmicdrift/kumiko-renderer/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AUTH_MFA_FEATURE_I18N } from "../i18n.ts";
import { mfaDisableScreen } from "../screens.ts";
import { AuthMfaHandlers, MFA_DISABLE_SCREEN_ID } from "../web/constants.ts";

const SCREEN_QN = `auth-mfa:screen:${MFA_DISABLE_SCREEN_ID}`;
const stubLiveEvents: LiveEventSubscriber = () => () => {};
const stubTokens = {
  tokens: defaultTokens,
  mode: "light" as const,
  setMode: () => {},
  toggleMode: () => {},
};
const STUB_ERROR: DispatcherError = {
  code: "stub",
  httpStatus: 500,
  i18nKey: "stub",
  message: "stub dispatcher has no queries",
};
const featureTranslations = {
  en: Object.fromEntries(
    Object.entries(AUTH_MFA_FEATURE_I18N).map(([key, text]) => [key, text.en]),
  ),
};
const schema: FeatureSchema = {
  featureName: "auth-mfa",
  entities: {},
  screens: [mfaDisableScreen],
};

function makeDispatcher(writes: Array<{ type: string; payload: unknown }>): Dispatcher {
  return {
    // The generic WriteResult<T> admits no concrete success literal; the form only reads isSuccess.
    write: (async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: { disabled: true } };
    }) as unknown as Dispatcher["write"],
    query: async () => ({ isSuccess: false, error: STUB_ERROR }),
    batch: async () => ({ isSuccess: true, results: [] }),
    statusStore: createStore<DispatcherStatus>("online"),
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

describe("auth-mfa disable screen", () => {
  test("confirms the disable and clears the spent code after a successful submit", async () => {
    const writes: Array<{ type: string; payload: unknown }> = [];
    render(
      <TokensProvider value={stubTokens}>
        <LocaleProvider
          resolver={createStaticLocaleResolver({ locale: "en" })}
          fallbackBundles={[featureTranslations, kumikoDefaultTranslations]}
        >
          <PrimitivesProvider value={defaultPrimitives}>
            <LiveEventsProvider value={stubLiveEvents}>
              <DispatcherProvider dispatcher={makeDispatcher(writes)}>
                <NavProvider
                  value={{
                    route: { screenId: SCREEN_QN },
                    navigate: () => {},
                    replace: () => {},
                    hrefFor: () => "#",
                    searchParams: {},
                    setSearchParams: () => {},
                  }}
                >
                  <KumikoScreen schema={schema} qn={SCREEN_QN} />
                </NavProvider>
              </DispatcherProvider>
            </LiveEventsProvider>
          </PrimitivesProvider>
        </LocaleProvider>
      </TokensProvider>,
    );
    const codeInput = await waitFor(() => {
      const input = screen.getByTestId("field-code").querySelector("input");
      if (input === null) throw new Error("expected the code input");
      return input;
    });
    fireEvent.change(codeInput, { target: { value: "123456" } });
    const submit = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.getByTestId("action-form-success").textContent).toContain(
        "Two-factor authentication is now turned off.",
      ),
    );
    expect(writes).toEqual([{ type: AuthMfaHandlers.disable, payload: { code: "123456" } }]);
    const clearedInput = screen.getByTestId("field-code").querySelector("input");
    expect(clearedInput?.value).toBe("");
  });
});
