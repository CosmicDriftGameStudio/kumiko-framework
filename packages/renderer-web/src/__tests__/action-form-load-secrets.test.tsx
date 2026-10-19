import { afterEach, describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { useBrowserNavApi } from "../app/nav.tsx";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const screenDef: ActionFormScreenDefinition = {
  id: "edit-credentials",
  type: "actionForm",
  handler: "app:write:credentials:update",
  load: { query: "app:query:credentials:detail" },
  fields: {
    label: { type: "text" },
    apiToken: { type: "text", format: "password" },
    webhookSecret: { type: "text", sensitive: true },
  } as ActionFormScreenDefinition["fields"],
  layout: { sections: [{ title: "Credentials", fields: ["label", "apiToken", "webhookSecret"] }] },
};

const schema: FeatureSchema = { featureName: "app", entities: {}, screens: [screenDef] };

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("actionForm load never fills secret fields", () => {
  test("a loaded record fills the plain field but not password or sensitive ones", async () => {
    window.history.replaceState(null, "", "/edit-credentials?id=c-1");
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "c-1", label: "Prod", apiToken: "tok-123", webhookSecret: "whsec-9" },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <BrowserNav>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={schema} qn="app:screen:edit-credentials" />
        </DispatcherProvider>
      </BrowserNav>,
    );
    await waitFor(() => {
      const label = screen.getByTestId("field-label").querySelector("input");
      expect(label?.value).toBe("Prod");
    });
    expect(screen.getByTestId("field-apiToken").querySelector("input")?.value).toBe("");
    expect(screen.getByTestId("field-webhookSecret").querySelector("input")?.value).toBe("");
  });
});
