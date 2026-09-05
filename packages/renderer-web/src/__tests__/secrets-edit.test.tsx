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
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils";

const secretsScreen: SecretsEditScreenDefinition = {
  id: "secrets",
  type: "secretsEdit",
  secretKeys: { "stripe-api-key": "stripe:secret:api-key" },
  fieldLabels: { "stripe-api-key": "config.secret.stripe.api-key.label" },
  sections: [{ fields: ["stripe-api-key"] }],
};

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
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    await waitFor(() => screen.getByText("sk_***abc"));
    const input = screen.getByTestId("secret-input-stripe-api-key") as HTMLInputElement;
    expect(input.value).toBe("");
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

  test("an unset required secret shows the required marker; a set one does not", async () => {
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
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={requiredSchema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    await waitFor(() => screen.getByTestId("required-marker-stripe-api-key"));
  });

  test("a set required secret does not show the required marker", async () => {
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
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={requiredSchema} qn="config:screen:secrets" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("secrets-edit-form"));
    await waitFor(() => screen.getByText("sk_***abc"));
    expect(screen.queryByTestId("required-marker-stripe-api-key")).toBeNull();
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

    await waitFor(() => expect(writeSpy).toHaveBeenCalledTimes(1));
    expect(writeSpy).toHaveBeenCalledWith("secrets:write:delete", { key: "stripe:secret:api-key" });
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
