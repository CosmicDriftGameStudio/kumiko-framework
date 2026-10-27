// The mail account list offers "Connect mailbox" only when the app mounts the IMAP provider: the
// button's target form belongs to that feature, and the renderer drops a navigate action whose
// screen is not mounted.

import { describe, expect, test } from "bun:test";
import {
  buildAppSchema,
  createRegistry,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AppFeaturesProvider,
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
import { render, screen } from "@testing-library/react";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import {
  createInboundMailFoundationFeature,
  INBOUND_MAIL_FOUNDATION_FEATURE,
  MAIL_ACCOUNT_LIST_SCREEN_QN,
  MY_MAIL_ACCOUNT_LIST_SCREEN_QN,
} from "../../inbound-mail-foundation/index.ts";
import { createSecretsFeature } from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { createInboundProviderImapFeature } from "../feature.ts";

const CONNECT_BUTTON = "render-list-toolbar-action-connect-imap";
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
  message: "the test never writes",
};

// A failed list query shows the screen error instead of the list, so the query answers with an
// empty page; its generic result type has no non-cast way to say so.
const emptyListDispatcher: Dispatcher = {
  write: async () => ({ isSuccess: false, error: STUB_ERROR }),
  query: async <TData,>() => ({ isSuccess: true as const, data: { rows: [] } as TData }),
  batch: async () => ({ isSuccess: true, results: [] }),
  statusStore: createStore<DispatcherStatus>("online"),
  async *stream() {},
  pendingWrites: () => [],
  pendingFiles: () => [],
};

function appSchema(withImap: boolean) {
  const features: FeatureDefinition[] = [
    createConfigFeature(),
    createTenantFeature(),
    createSecretsFeature(),
    createComplianceProfilesFeature(),
    createTenantLifecycleFeature(),
    createInboundMailFoundationFeature(),
    ...(withImap ? [createInboundProviderImapFeature()] : []),
  ];
  return buildAppSchema(createRegistry(features)).features;
}

function renderList(withImap: boolean, qn = MAIL_ACCOUNT_LIST_SCREEN_QN, roles = ["TenantAdmin"]) {
  const features = appSchema(withImap);
  const foundation = features.find((f) => f.featureName === INBOUND_MAIL_FOUNDATION_FEATURE);
  if (foundation === undefined) throw new Error("expected the inbound-mail-foundation schema");
  render(
    <TokensProvider value={stubTokens}>
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <PrimitivesProvider value={defaultPrimitives}>
          <LiveEventsProvider value={stubLiveEvents}>
            <DispatcherProvider dispatcher={emptyListDispatcher}>
              <NavProvider
                value={{
                  route: { screenId: qn },
                  navigate: () => {},
                  replace: () => {},
                  hrefFor: () => "#",
                  searchParams: {},
                  setSearchParams: () => {},
                }}
              >
                <AppFeaturesProvider features={features}>
                  <UserRolesProvider roles={roles}>
                    <KumikoScreen schema={foundation} qn={qn} />
                  </UserRolesProvider>
                </AppFeaturesProvider>
              </NavProvider>
            </DispatcherProvider>
          </LiveEventsProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>,
  );
}

describe("connect mailbox toolbar button", () => {
  test("shows on the mail account list when the IMAP provider is mounted", async () => {
    renderList(true);
    expect(await screen.findByTestId(CONNECT_BUTTON)).toBeDefined();
  });

  test("is absent without the IMAP provider", async () => {
    renderList(false);
    await screen.findByTestId("render-list-table-empty");
    expect(screen.queryByTestId(CONNECT_BUTTON)).toBeNull();
  });
});

describe("connect mailbox toolbar button on My mail accounts", () => {
  test("shows for a plain member when the IMAP provider is mounted", async () => {
    renderList(true, MY_MAIL_ACCOUNT_LIST_SCREEN_QN, ["User"]);
    expect(await screen.findByTestId(CONNECT_BUTTON)).toBeDefined();
  });

  test("is absent without the IMAP provider", async () => {
    renderList(false, MY_MAIL_ACCOUNT_LIST_SCREEN_QN, ["User"]);
    await screen.findByTestId("render-list-table-empty");
    expect(screen.queryByTestId(CONNECT_BUTTON)).toBeNull();
  });
});
