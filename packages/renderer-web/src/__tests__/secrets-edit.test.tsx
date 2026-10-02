//
// Unit tests for the secretsEdit screen type. Secrets are write-only — the
// security invariant this file exists to pin: an input NEVER starts pre-filled
// with the redacted preview, and no dispatched payload ever carries that
// preview string next to the plaintext the user typed.
//
// `as unknown as Dispatcher["query"/"batch"/"write"]` throughout: each inline
// mock lambda only implements the one overload a given test exercises, never
// the full overloaded Dispatcher signature — the missing overloads are never
// called at runtime.

import { describe, expect, mock, test } from "bun:test";
import type { SecretsEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher, DispatcherError } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
} from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.js";

const secretsScreen: SecretsEditScreenDefinition = {
  id: "secrets",
  type: "secretsEdit",
  secretKeys: { "stripe-api-key": "stripe:secret:api-key" },
  fieldLabels: { "stripe-api-key": "config.secret.stripe.api-key.label" },
  sections: [{ fields: ["stripe-api-key"] }],
};

const secretsCopy = {
  en: {
    ...kumikoDefaultTranslations["en"],
    "config.secrets.saved": "Saved",
    "config.secrets.notSet": "Not set",
    "config.secrets.stored": "Stored: {preview}",
  },
};
const secretsResolver = createStaticLocaleResolver();

function WithSecretsCopy({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={secretsResolver} fallbackBundles={[secretsCopy]}>
      {children}
    </LocaleProvider>
  );
}

const schema: FeatureSchema = {
  featureName: "config",
  entities: {},
  screens: [secretsScreen],
};

describe("KumikoScreen / secretsEdit", () => {
  test("a set secret shows its redacted preview while the input stays empty", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: [{ key: "stripe:secret:api-key", redactedPreview: "sk_***abc", hint: null }],
      })) as unknown as Dispatcher["query"],
    });

    render(
      <WithSecretsCopy>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={schema} qn="config:screen:secrets" />
        </DispatcherProvider>
      </WithSecretsCopy>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    await waitFor(() => screen.getByText("Stored: sk_***abc"));
    expect(screen.getByTestId("secret-saved-stripe-api-key").textContent).toContain("Saved");
    const input = screen.getByTestId("secret-input-stripe-api-key") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  test("untitled feature sections share ONE settings band with one labelled row per secret", async () => {
    const multiScreen: SecretsEditScreenDefinition = {
      id: "secrets",
      type: "secretsEdit",
      secretKeys: { "a-key": "a:secret:key", "b-key": "b:secret:key" },
      fieldLabels: { "a-key": "A label", "b-key": "B label" },
      sections: [{ fields: ["a-key"] }, { fields: ["b-key"] }],
    };
    const multiSchema: FeatureSchema = {
      featureName: "config",
      entities: {},
      screens: [multiScreen],
    };
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: [] })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={multiSchema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );
    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    expect(document.querySelectorAll("section").length).toBe(1);
    expect(screen.getByTestId("field-a-key").textContent).toContain("A label");
    expect(screen.getByTestId("field-b-key").textContent).toContain("B label");
  });

  test("submitting with no input dispatches nothing", async () => {
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: true as const,
      results: [],
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: [] })) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    await user.click(screen.getByTestId("secrets-edit-submit"));
    expect(batchSpy).not.toHaveBeenCalled();
  });

  test("footer: Save is disabled while clean; typing counts the change and Discard clears the input", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: [] })) as unknown as Dispatcher["query"],
    });
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    expect((screen.getByTestId("secrets-edit-submit") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("secrets-edit-discard")).toBeNull();

    const input = screen.getByTestId("secret-input-stripe-api-key") as HTMLInputElement;
    await user.type(input, "abc");
    expect((screen.getByTestId("secrets-edit-submit") as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByTestId("secrets-edit-discard"));
    expect((screen.getByTestId("secret-input-stripe-api-key") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("secrets-edit-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  test("typing a value and saving dispatches exactly one secrets:write:set with the plaintext, never the redacted preview", async () => {
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: true as const,
      results: [],
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: [{ key: "stripe:secret:api-key", redactedPreview: "sk_***abc", hint: null }],
      })) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    const input = screen.getByTestId("secret-input-stripe-api-key");
    await user.type(input, "sk_live_newvalue");
    await user.click(screen.getByTestId("secrets-edit-submit"));

    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    const commands = batchSpy.mock.calls[0]?.[0];
    if (!commands) throw new Error("batchSpy not called");
    expect(commands).toEqual([
      {
        type: "secrets:write:set",
        payload: { key: "stripe:secret:api-key", value: "sk_live_newvalue" },
      },
    ]);
    // The security invariant this test exists for: the preview never rides
    // along in a write payload next to the plaintext.
    expect(JSON.stringify(commands)).not.toContain("sk_***abc");
  });

  test("an unset required secret shows a Not set badge in the bad tone", async () => {
    const requiredScreen: SecretsEditScreenDefinition = {
      ...secretsScreen,
      requiredFields: ["stripe-api-key"],
    };
    const requiredSchema: FeatureSchema = {
      featureName: "config",
      entities: {},
      screens: [requiredScreen],
    };

    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: [] })) as unknown as Dispatcher["query"],
    });

    render(
      <WithSecretsCopy>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={requiredSchema} qn="config:screen:secrets" />
        </DispatcherProvider>
      </WithSecretsCopy>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    const badge = await waitFor(() => screen.getByTestId("secret-not-set-stripe-api-key"));
    expect(badge.textContent).toContain("Not set");
    expect(badge.className).toContain("status-bad");
  });

  test("a set required secret shows Saved, not Not set", async () => {
    const requiredScreen: SecretsEditScreenDefinition = {
      ...secretsScreen,
      requiredFields: ["stripe-api-key"],
    };
    const requiredSchema: FeatureSchema = {
      featureName: "config",
      entities: {},
      screens: [requiredScreen],
    };
    const qualifiedKey = requiredScreen.secretKeys["stripe-api-key"];

    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: [{ key: qualifiedKey, redactedPreview: "sk_***abc", hint: null }],
      })) as unknown as Dispatcher["query"],
    });

    render(
      <WithSecretsCopy>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={requiredSchema} qn="config:screen:secrets" />
        </DispatcherProvider>
      </WithSecretsCopy>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    await waitFor(() => screen.getByText("Stored: sk_***abc"));
    expect(screen.queryByTestId("secret-not-set-stripe-api-key")).toBeNull();
    expect(screen.getByTestId("secret-saved-stripe-api-key")).toBeTruthy();
  });

  test("an unset required secret does not block saving a different secret", async () => {
    const twoFieldScreen: SecretsEditScreenDefinition = {
      id: "secrets",
      type: "secretsEdit",
      secretKeys: {
        "stripe-api-key": "stripe:secret:[REDACTED:API key param]",
        "webhook-secret": "stripe:secret:[REDACTED:webhook param]",
      },
      fieldLabels: {
        "stripe-api-key": "config.secret.stripe.api-key.label",
        "webhook-secret": "config.secret.stripe.webhook.label",
      },
      sections: [{ fields: ["stripe-api-key", "webhook-secret"] }],
      requiredFields: ["stripe-api-key"],
    };
    const twoFieldSchema: FeatureSchema = {
      featureName: "config",
      entities: {},
      screens: [twoFieldScreen],
    };
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: true as const,
      results: [],
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: [] })) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={twoFieldSchema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    const requiredInput = screen.getByTestId("secret-input-stripe-api-key") as HTMLInputElement;
    expect(requiredInput.required).toBe(false);

    await user.type(screen.getByTestId("secret-input-webhook-secret"), "whsec_newvalue");
    await user.click(screen.getByTestId("secrets-edit-submit"));

    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    const commands = batchSpy.mock.calls[0]?.[0];
    if (!commands) throw new Error("batchSpy not called");
    expect(commands).toEqual([
      {
        type: "secrets:write:set",
        payload: { key: "stripe:secret:[REDACTED:webhook param]", value: "whsec_newvalue" },
      },
    ]);
  });

  test("delete dispatches secrets:write:delete with the qualified key", async () => {
    const writeSpy = mock(async (_type: string, _payload: unknown) => ({
      isSuccess: true as const,
      data: {},
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: [{ key: "stripe:secret:api-key", redactedPreview: "sk_***abc", hint: null }],
      })) as unknown as Dispatcher["query"],
      write: writeSpy as unknown as Dispatcher["write"],
    });

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    await user.click(screen.getByTestId("secret-delete-stripe-api-key"));
    expect(writeSpy).not.toHaveBeenCalled();
    await user.click(await screen.findByTestId("secrets-delete-dialog-confirm"));

    await waitFor(() => expect(writeSpy).toHaveBeenCalledTimes(1));
    expect(writeSpy).toHaveBeenCalledWith("secrets:write:delete", { key: "stripe:secret:api-key" });
  });

  test("cancelling the delete confirmation dispatches nothing", async () => {
    const writeSpy = mock(async (_type: string, _payload: unknown) => ({
      isSuccess: true as const,
      data: {},
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: [{ key: "stripe:secret:api-key", redactedPreview: "sk_***abc", hint: null }],
      })) as unknown as Dispatcher["query"],
      write: writeSpy as unknown as Dispatcher["write"],
    });

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    await user.click(screen.getByTestId("secret-delete-stripe-api-key"));
    await user.click(await screen.findByTestId("secrets-delete-dialog-cancel"));

    expect(writeSpy).not.toHaveBeenCalled();
  });

  test("a failed save shows the error and never renders the typed plaintext", async () => {
    const plaintext = "sk_live_wouldbeleakedifechoed";
    const serverError: DispatcherError = {
      code: "TENANT_SECRET_WRITE_CONFLICT",
      httpStatus: 409,
      i18nKey: "secrets:errors.writeConflict",
      message: "Could not save secret: a concurrent update conflicted, please retry.",
    };
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: false as const,
      error: serverError,
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: [] })) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    const input = screen.getByTestId("secret-input-stripe-api-key");
    await user.type(input, plaintext);
    await user.click(screen.getByTestId("secrets-edit-submit"));

    await waitFor(() => screen.getByTestId("secrets-edit-error"));
    expect(screen.getByTestId("secrets-edit-error").textContent).toContain(serverError.message);
    // The drafted plaintext must never leak into the error surface (or
    // anywhere else in the DOM besides the input's own `value`).
    expect(document.body.textContent).not.toContain(plaintext);
  });
});
