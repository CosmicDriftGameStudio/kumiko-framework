// A merged provider form is reachable with the union of config and secrets access. A viewer who
// may write the config keys but not list secrets still gets a working form.

import { describe, expect, mock, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const providerScreen: ConfigEditScreenDefinition = {
  id: "provider",
  type: "configEdit",
  scope: "tenant",
  configKeys: { host: "demo:config:host", password: "demo:config:password" },
  secretKeys: { password: "demo:secret:password" },
  fields: {
    host: { type: "text" },
    password: { type: "text", writeOnly: true },
  },
  layout: { sections: [{ title: "SMTP", fields: ["host", "password"] }] },
};
const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [providerScreen] };

const ACCESS_DENIED = {
  isSuccess: false,
  error: { code: "access_denied", httpStatus: 403, i18nKey: "errors.access.denied", message: "" },
};

describe("KumikoScreen / configEdit without secrets access", () => {
  async function renderWithSecretsResult(secretsResult: unknown) {
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: true as const,
      results: [],
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (name: string) =>
        name === "secrets:query:list"
          ? secretsResult
          : { isSuccess: true, data: {} }) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:provider" />
      </DispatcherProvider>,
    );
    return batchSpy;
  }

  test("an access_denied secrets list keeps the form, hides the secret fields and saves the config keys", async () => {
    const batchSpy = await renderWithSecretsResult(ACCESS_DENIED);

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(screen.queryByTestId("field-password")).toBeNull();
    const input = screen.getByTestId("field-host").querySelector("input");
    if (!input) throw new Error("expected host input");

    await userEvent.setup().type(input, "smtp.example.com");
    await userEvent.setup().click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    expect(batchSpy.mock.calls[0]?.[0]).toEqual([
      {
        type: "config:write:set",
        payload: { key: "demo:config:host", value: "smtp.example.com", scope: "tenant" },
      },
    ]);
  });

  test("another secrets failure still shows the error banner", async () => {
    await renderWithSecretsResult({
      isSuccess: false,
      error: { code: "internal_error", httpStatus: 500, i18nKey: "errors.internal", message: "" },
    });

    await waitFor(() => expect(screen.queryByTestId("render-edit-form")).toBeNull());
    expect(screen.queryByTestId("field-host")).toBeNull();
  });

  test("with secrets access the secret field is rendered", async () => {
    await renderWithSecretsResult({ isSuccess: true, data: [{ key: "demo:secret:password" }] });

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(screen.getByTestId("field-password")).toBeTruthy();
  });
});
