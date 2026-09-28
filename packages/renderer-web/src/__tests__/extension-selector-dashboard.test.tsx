// The generated Settings-Hub dashboard of an extension selector, rendered from
// the REAL generator output (buildConfigFeatureSchema) — selection form plus
// per-provider config/secrets panels that show only for the saved provider.
//
// `as unknown as Dispatcher[...]`: each mock lambda implements only the overload
// the test exercises.

import { describe, expect, mock, test } from "bun:test";
import {
  access,
  buildConfigFeatureSchema,
  createRegistry,
  createTenantConfig,
  defineFeature,
  SELECTED_EXTENSIONS_QUERY,
} from "@cosmicdrift/kumiko-framework/engine";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  AppFeaturesProvider,
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  NavProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import * as z from "zod";
import { WebDashboardBody } from "../app/dashboard-body";
import { useBrowserNavApi } from "../app/nav";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils";

const TENANT_ADMIN_WRITE = access.roles("TenantAdmin");

const secretsMount = defineFeature("secrets", (r) => {
  r.writeHandler(
    "set",
    z.object({ key: z.string(), value: z.string() }),
    async () => ({ isSuccess: true, data: null }),
    { access: { roles: ["TenantAdmin"] } },
  );
});

const mailFoundation = defineFeature("mail-foundation", (r) => {
  r.translations({ keys: { "mail-foundation.settings": { en: "Mail" } } });
  r.extendsRegistrar("mailTransport", { onRegister: () => undefined });
  const keys = r.config({
    keys: {
      provider: createTenantConfig("text", {
        default: "",
        write: TENANT_ADMIN_WRITE,
        mask: { title: "mail.provider" },
      }),
    },
  });
  r.extensionSelector("mailTransport", keys.provider);
});

const smtp = defineFeature("mail-smtp", (r) => {
  r.useExtension("mailTransport", "smtp");
  r.config({
    keys: {
      host: createTenantConfig("text", {
        default: "",
        write: TENANT_ADMIN_WRITE,
        mask: { title: "smtp.host" },
      }),
    },
  });
  r.secret("password", { label: { en: "SMTP password" }, scope: "tenant", required: true });
});

const inmemory = defineFeature("mail-inmemory", (r) => {
  r.useExtension("mailTransport", "inmemory");
  r.config({
    keys: {
      capture: createTenantConfig("boolean", {
        write: TENANT_ADMIN_WRITE,
        mask: { title: "inmemory.capture" },
      }),
    },
  });
});

const generated = buildConfigFeatureSchema(
  createRegistry([secretsMount, mailFoundation, smtp, inmemory]),
);
const hubSchema: FeatureSchema = {
  featureName: "config",
  entities: {},
  screens: generated.screens,
};

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

function renderHub(dispatcher: Dispatcher): void {
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <AppFeaturesProvider features={[hubSchema]}>
        <UserRolesProvider roles={["TenantAdmin"]}>
          <BrowserNav>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={hubSchema} qn="config:screen:mail-foundation-tenant" />
            </DashboardBodyProvider>
          </BrowserNav>
        </UserRolesProvider>
      </AppFeaturesProvider>
    </DispatcherProvider>,
  );
}

function hubQuery(selected: Record<string, string>): Dispatcher["query"] {
  return (async (type: string) => {
    if (type === SELECTED_EXTENSIONS_QUERY) return { isSuccess: true, data: selected };
    if (type === "config:query:values") {
      const provider = selected["mailTransport"];
      return {
        isSuccess: true,
        data:
          provider === undefined
            ? {}
            : { "mail-foundation:config:provider": { value: provider, scope: "tenant" } },
      };
    }
    return { isSuccess: true, data: [] };
  }) as unknown as Dispatcher["query"];
}

describe("generated extension-selector dashboard", () => {
  test("shows only the selected provider's config and secrets panels", async () => {
    renderHub(createMockDispatcher({ query: hubQuery({ mailTransport: "smtp" }) }));

    await waitFor(() => screen.getByTestId("dashboard-panel-mail-smtp-config"));
    expect(screen.getByTestId("dashboard-panel-selection")).toBeTruthy();
    await waitFor(() => screen.getByTestId("dashboard-panel-mail-smtp-secrets"));
    expect(screen.queryByTestId("dashboard-panel-mail-inmemory-config")).toBeNull();
  });

  test("another provider swaps the panels", async () => {
    renderHub(createMockDispatcher({ query: hubQuery({ mailTransport: "inmemory" }) }));

    await waitFor(() => screen.getByTestId("dashboard-panel-mail-inmemory-config"));
    expect(screen.queryByTestId("dashboard-panel-mail-smtp-config")).toBeNull();
    expect(screen.queryByTestId("dashboard-panel-mail-smtp-secrets")).toBeNull();
  });

  test("saving the selection works while the hidden provider panels hold a required secret", async () => {
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: true as const,
      results: [],
    }));
    renderHub(
      createMockDispatcher({
        query: hubQuery({}),
        batch: batchSpy as unknown as Dispatcher["batch"],
      }),
    );

    await waitFor(() => screen.getByTestId("dashboard-panel-selection"));
    expect(screen.queryByTestId("dashboard-panel-mail-smtp-secrets")).toBeNull();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "smtp" }));
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    expect(batchSpy.mock.calls[0]?.[0]).toEqual([
      {
        type: "config:write:set",
        payload: { key: "mail-foundation:config:provider", value: "smtp", scope: "tenant" },
      },
    ]);
  });
});
