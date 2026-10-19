// The generated Settings-Hub form of an extension selector, rendered from the REAL
// generator output (buildConfigFeatureSchema) — one form for the provider and every
// provider's settings and secrets, shown for the provider picked in the form. The
// chromeless dashboard panel is what an owner with extra panels embeds that form in.
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
} from "@cosmicdrift/kumiko-framework/engine";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import * as z from "zod";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  AppFeaturesProvider,
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  NavProvider,
  UserRolesProvider,
} from "../../index.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const TENANT_ADMIN_WRITE = access.roles("TenantAdmin");

const secretsMount = defineFeature("secrets", (r) => {
  r.writeHandler({
    name: "set",
    schema: z.object({ key: z.string(), value: z.string() }),
    handler: async () => ({ isSuccess: true, data: null }),
    access: { roles: ["TenantAdmin"] },
  });
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

const PROVIDER_FORM_ID = "mail-foundation-tenant";
const EMBEDDED_FORM_ID = "mail-foundation-tenant-selection";

function dashboardAroundForm(chromeless: boolean): FeatureSchema {
  return {
    ...hubSchema,
    screens: [
      ...generated.screens.map((screenDef) =>
        screenDef.id === PROVIDER_FORM_ID
          ? { ...screenDef, id: EMBEDDED_FORM_ID, dormant: true }
          : screenDef,
      ),
      {
        id: PROVIDER_FORM_ID,
        type: "dashboard",
        panels: [{ kind: "screen", id: "selection", screen: EMBEDDED_FORM_ID, chromeless }],
        access: { roles: ["TenantAdmin"] },
      },
    ],
  };
}

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

function renderHub(dispatcher: Dispatcher, schema: FeatureSchema = hubSchema): void {
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <AppFeaturesProvider features={[schema]}>
        <UserRolesProvider roles={["TenantAdmin"]}>
          <BrowserNav>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn="config:screen:mail-foundation-tenant" />
            </DashboardBodyProvider>
          </BrowserNav>
        </UserRolesProvider>
      </AppFeaturesProvider>
    </DispatcherProvider>,
  );
}

type HubState = { readonly provider?: string; readonly passwordStored?: boolean };

const SMTP_PASSWORD_KEY = "mail-smtp:secret:password";

function hubQuery(state: HubState): Dispatcher["query"] {
  return (async (type: string) => {
    if (type === "config:query:values") {
      return {
        isSuccess: true,
        data:
          state.provider === undefined
            ? {}
            : {
                "mail-foundation:config:provider": {
                  value: state.provider,
                  scope: "tenant",
                  source: "tenant-row",
                },
              },
      };
    }
    if (type === "secrets:query:list") {
      return {
        isSuccess: true,
        data: state.passwordStored ? [{ key: SMTP_PASSWORD_KEY, redactedPreview: null }] : [],
      };
    }
    return { isSuccess: true, data: {} };
  }) as unknown as Dispatcher["query"];
}

function batchSpy() {
  return mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
    isSuccess: true as const,
    results: [],
  }));
}

function inputOf(fieldName: string): HTMLInputElement {
  const input = screen.getByTestId(`field-${fieldName}`).querySelector("input");
  if (!input) throw new Error(`expected an input for ${fieldName}`);
  return input;
}

describe("generated extension-selector dashboard", () => {
  test("shows the saved provider's settings and secret, not the other provider's", async () => {
    renderHub(createMockDispatcher({ query: hubQuery({ provider: "smtp" }) }));

    await waitFor(() => screen.getByTestId("field-mail-smtp-host"));
    expect(screen.getByTestId("field-mail-smtp-password")).toBeTruthy();
    expect(screen.queryByTestId("field-mail-inmemory-capture")).toBeNull();
    expect(screen.queryByTestId("dashboard-panel-mail-smtp-config")).toBeNull();
  });

  test("a chromeless panel renders the embedded form without a padded scroll surface or card", async () => {
    const embedded = dashboardAroundForm(true);
    renderHub(createMockDispatcher({ query: hubQuery({ provider: "smtp" }) }), embedded);
    await waitFor(() => screen.getByTestId("field-mail-smtp-host"));
    const panel = screen.getByTestId("dashboard-panel-selection");
    expect(panel.querySelector("form")).not.toBeNull();
    expect(panel.querySelector("[data-slot=card]")).toBeNull();
    expect(panel.querySelector("[data-testid=render-edit-form-scroll]")).toBeNull();
  });

  test("without the chromeless option the embedded form keeps its padded screen-form surface", async () => {
    const framed = dashboardAroundForm(false);
    renderHub(createMockDispatcher({ query: hubQuery({ provider: "smtp" }) }), framed);
    await waitFor(() => screen.getByTestId("field-mail-smtp-host"));
    const panel = screen.getByTestId("dashboard-panel-selection");
    expect(panel.querySelector("[data-testid=render-edit-form-scroll]")).not.toBeNull();
  });

  test("picking another provider swaps the settings before anything is saved", async () => {
    renderHub(createMockDispatcher({ query: hubQuery({ provider: "smtp" }) }));
    await waitFor(() => screen.getByTestId("field-mail-smtp-host"));

    await userEvent.setup().click(screen.getByRole("radio", { name: "inmemory" }));

    await waitFor(() => screen.getByTestId("field-mail-inmemory-capture"));
    expect(screen.queryByTestId("field-mail-smtp-host")).toBeNull();
    expect(screen.queryByTestId("field-mail-smtp-password")).toBeNull();
  });

  test("one save writes the provider, its settings and its password", async () => {
    const batch = batchSpy();
    renderHub(
      createMockDispatcher({
        query: hubQuery({}),
        batch: batch as unknown as Dispatcher["batch"],
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "smtp" }));
    await waitFor(() => screen.getByTestId("field-mail-smtp-host"));
    await user.type(inputOf("mail-smtp-host"), "smtp.example.test");
    await user.type(inputOf("mail-smtp-password"), "smtp-password-for-the-test");
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    expect(batch.mock.calls[0]?.[0]).toEqual([
      {
        type: "config:write:set",
        payload: { key: "mail-foundation:config:provider", value: "smtp", scope: "tenant" },
      },
      {
        type: "config:write:set",
        payload: { key: "mail-smtp:config:host", value: "smtp.example.test", scope: "tenant" },
      },
      {
        type: "secrets:write:set",
        payload: { key: SMTP_PASSWORD_KEY, value: "smtp-password-for-the-test" },
      },
    ]);
  });

  test("input for a provider that is no longer picked is not saved", async () => {
    const batch = batchSpy();
    renderHub(
      createMockDispatcher({
        query: hubQuery({}),
        batch: batch as unknown as Dispatcher["batch"],
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "smtp" }));
    await waitFor(() => screen.getByTestId("field-mail-smtp-host"));
    await user.type(inputOf("mail-smtp-host"), "smtp.example.test");
    await user.click(screen.getByRole("radio", { name: "inmemory" }));
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    expect(batch.mock.calls[0]?.[0]).toEqual([
      {
        type: "config:write:set",
        payload: { key: "mail-foundation:config:provider", value: "inmemory", scope: "tenant" },
      },
    ]);
  });

  test("a stored password shows as set and removing it deletes the secret", async () => {
    const batch = batchSpy();
    renderHub(
      createMockDispatcher({
        query: hubQuery({ provider: "smtp", passwordStored: true }),
        batch: batch as unknown as Dispatcher["batch"],
      }),
    );
    await waitFor(() => screen.getByTestId("field-mail-smtp-password"));
    expect(inputOf("mail-smtp-password").placeholder).toBe("Set — leave empty to keep it");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove stored value" }));
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    expect(batch.mock.calls[0]?.[0]).toEqual([
      { type: "secrets:write:delete", payload: { key: SMTP_PASSWORD_KEY } },
    ]);
  });
});
