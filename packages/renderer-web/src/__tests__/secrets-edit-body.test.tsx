// SecretsEditScreenDefinition.description exists (types/src/screen.ts:1205)
// to explain what the secrets on this screen are for, same doc-promise as
// every other description slot — but SecretsEditBody built its own <Form>
// without ever reading screen.description. Fixed by wiring it into the
// Form's established subtitle slot (same slot render-edit.tsx and
// write-form-section.tsx use), rendered through DefaultForm — real
// renderer-web primitives, not a stub, so this proves the actual DOM output.

import { describe, expect, test } from "bun:test";
import type { SecretsEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { DispatcherProvider } from "@cosmicdrift/kumiko-renderer";
import { SecretsEditBody } from "../../../renderer/src/app/secrets-edit-body";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils";

function makeDispatcher(): Dispatcher {
  return createMockDispatcher({
    query: (async () => ({ isSuccess: true, data: [] })) as Dispatcher["query"],
  });
}

function baseScreen(): SecretsEditScreenDefinition {
  return {
    id: "integrations:screen:secrets",
    type: "secretsEdit",
    secretKeys: { apiKey: "integrations:secret:api-key" },
    fieldLabels: { apiKey: "API key" },
    sections: [{ fields: ["apiKey"] }],
  };
}

describe("SecretsEditBody — screen.description as form subtitle", () => {
  test("a plain-text description renders as the form's subtitle", async () => {
    const screenDef: SecretsEditScreenDefinition = {
      ...baseScreen(),
      description: "These credentials are shared across every integration on this workspace.",
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <SecretsEditBody screen={screenDef} />
      </DispatcherProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("secrets-edit-form-subtitle").textContent).toBe(
        "These credentials are shared across every integration on this workspace.",
      ),
    );
  });

  test("a description that is a known i18n key renders translated, not as the raw key", async () => {
    const screenDef: SecretsEditScreenDefinition = {
      ...baseScreen(),
      description: "integrations:secrets.explainer",
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <SecretsEditBody
          screen={screenDef}
          translate={(key) =>
            key === "integrations:secrets.explainer" ? "Rotate these keys every 90 days." : key
          }
        />
      </DispatcherProvider>,
    );

    await waitFor(() => {
      const subtitle = screen.getByTestId("secrets-edit-form-subtitle");
      expect(subtitle.textContent).toBe("Rotate these keys every 90 days.");
      expect(subtitle.textContent).not.toBe("integrations:secrets.explainer");
    });
  });

  test("a screen without description renders no subtitle at all", async () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <SecretsEditBody screen={baseScreen()} />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("secrets-edit-form")).toBeTruthy());
    expect(screen.queryByTestId("secrets-edit-form-subtitle")).toBeNull();
  });
});
