// The rename form as the browser runs it: the row action's prefill reaches the
// form, and the submit sends only id and name; the audit reason is
// derived server-side. The provider wrapper is local because the
// renderer/web to bundled-features dependency direction forbids test-utils.

import { describe, expect, test } from "bun:test";
import { buildAppSchema, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  NavProvider,
  PrimitivesProvider,
  TokensProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import {
  createStore,
  type Dispatcher,
  type DispatcherError,
  type DispatcherStatus,
} from "@cosmicdrift/kumiko-renderer/headless";
import { defaultPrimitives, defaultTokens } from "@cosmicdrift/kumiko-renderer/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { INBOUND_MAIL_FOUNDATION_FEATURE } from "../constants.ts";
import { createInboundMailFoundationFeature } from "../feature.ts";
import { INBOUND_MAIL_FOUNDATION_I18N } from "../i18n.ts";

const ACCOUNT_ID = "6f1c0e0e-0000-4000-8000-000000000001";
const stubLiveEvents: LiveEventSubscriber = () => () => {};
const stubTokens = {
  tokens: defaultTokens,
  mode: "light" as const,
  setMode: () => {},
  toggleMode: () => {},
};

// The client schema is what derives the form's URL prefill from the list's
// row-action params, so the test goes through buildAppSchema like the server.
function featureSchema() {
  const feature = buildAppSchema(
    createRegistry([
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
    ]),
  ).features.find((f) => f.featureName === INBOUND_MAIL_FOUNDATION_FEATURE);
  if (feature === undefined) throw new Error("expected the inbound-mail-foundation schema");
  return feature;
}

const STUB_ERROR: DispatcherError = {
  code: "stub",
  httpStatus: 500,
  i18nKey: "stub",
  message: "stub dispatcher answers every call with a failure",
};

// A failure result is assignable to every generic WriteResult/QueryResult without a
// cast; the test only inspects which write was issued.
function makeDispatcher(writes: Array<{ type: string; payload: unknown }>): Dispatcher {
  return {
    write: async (type, payload) => {
      writes.push({ type, payload });
      return { isSuccess: false, error: STUB_ERROR };
    },
    query: async () => ({ isSuccess: false, error: STUB_ERROR }),
    batch: async () => ({ isSuccess: true, results: [] }),
    statusStore: createStore<DispatcherStatus>("online"),
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

describe("mail-account-edit screen", () => {
  test("prefills id and name from the row action and submits them without a client-side audit reason", async () => {
    const writes: Array<{ type: string; payload: unknown }> = [];
    render(
      <TokensProvider value={stubTokens}>
        <LocaleProvider
          resolver={createStaticLocaleResolver({ locale: "en" })}
          fallbackBundles={[INBOUND_MAIL_FOUNDATION_I18N, kumikoDefaultTranslations]}
        >
          <PrimitivesProvider value={defaultPrimitives}>
            <LiveEventsProvider value={stubLiveEvents}>
              <DispatcherProvider dispatcher={makeDispatcher(writes)}>
                <NavProvider
                  value={{
                    route: {
                      screenId: `${INBOUND_MAIL_FOUNDATION_FEATURE}:screen:mail-account-edit`,
                    },
                    navigate: () => {},
                    replace: () => {},
                    hrefFor: () => "#",
                    searchParams: { accountId: ACCOUNT_ID, displayName: "Team" },
                    setSearchParams: () => {},
                  }}
                >
                  <UserRolesProvider roles={["TenantAdmin"]}>
                    <KumikoScreen
                      schema={featureSchema()}
                      qn={`${INBOUND_MAIL_FOUNDATION_FEATURE}:screen:mail-account-edit`}
                    />
                  </UserRolesProvider>
                </NavProvider>
              </DispatcherProvider>
            </LiveEventsProvider>
          </PrimitivesProvider>
        </LocaleProvider>
      </TokensProvider>,
    );
    const nameInput = await screen.findByDisplayValue("Team");
    fireEvent.change(nameInput, { target: { value: "Team inbox" } });
    const submit = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      type: "inbound-mail-foundation:write:update-account",
      payload: { accountId: ACCOUNT_ID, displayName: "Team inbox" },
    });
  });
});
