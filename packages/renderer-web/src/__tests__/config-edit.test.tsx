//
// Unit-Tests für den configEdit-Screen-Type. Decken die Pfade ab die
// Integration + E2E nur indirekt sehen:
//   - Initial-Load via config:query:values + Pre-Fill aus values[qn]
//   - customSubmit dispatcht pro geändertem Field einen separaten
//     config:write:set Call mit dem qualifizierten Key + scope
//   - Save-Button Greying via controller.rebase nach Success
//   - Loading-State während config:query:values noch läuft

import { describe, expect, mock, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils";

const settingsScreen: ConfigEditScreenDefinition = {
  id: "settings",
  type: "configEdit",
  scope: "tenant",
  configKeys: {
    siteName: "demo:config:site-name",
    maxUploadMb: "demo:config:max-upload-mb",
  },
  fields: {
    siteName: { type: "text", required: true },
    maxUploadMb: { type: "number" },
    // @cast-boundary inline schema-author shape — FieldDefinition union too narrow
  } as ConfigEditScreenDefinition["fields"],
  layout: {
    sections: [{ title: "Basics", fields: ["siteName", "maxUploadMb"] }],
  },
};

const schema: FeatureSchema = {
  featureName: "demo",
  entities: {},
  screens: [settingsScreen],
};

describe("KumikoScreen / configEdit", () => {
  test("loading state while config:query:values is pending", async () => {
    let resolveQuery: (value: unknown) => void = () => {};
    const queryPending = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (() => queryPending) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    // Solange die query pending ist, rendert ConfigEditBody den
    // Loading-Banner (kein Form, kein vorzeitiges leeres Feld).
    expect(screen.getByTestId("kumiko-screen-loading")).toBeTruthy();

    // Cleanup: Query auflösen damit der useEffect-Subscriber sauber
    // unmounten kann ohne open-handle-Warning.
    resolveQuery({ isSuccess: true, data: {} });
    await waitFor(() => screen.queryByTestId("render-edit-form"));
  });

  test("loaded values pre-fill the form (string + numeric coercion)", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          "demo:config:site-name": { value: "Acme", scope: "tenant" },
          "demo:config:max-upload-mb": { value: 25, scope: "tenant" },
        },
      })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const siteInput = screen.getByTestId("field-siteName").querySelector("input");
    const maxInput = screen.getByTestId("field-maxUploadMb").querySelector("input");
    expect(siteInput?.value).toBe("Acme");
    expect(maxInput?.value).toBe("25");
  });

  test("submit dispatches one /api/batch with one command per changed field", async () => {
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: true as const,
      results: [],
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          "demo:config:site-name": { value: "Acme", scope: "tenant" },
          "demo:config:max-upload-mb": { value: 25, scope: "tenant" },
        },
      })) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const siteInput = screen.getByTestId("field-siteName").querySelector("input");
    if (!siteInput) throw new Error("expected siteName input");

    // Ändert NUR siteName — der Batch darf nur EIN Command enthalten,
    // nicht beide (unchanged-Field bleibt aus).
    await user.clear(siteInput);
    await user.type(siteInput, "Globex");
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(batchSpy).toHaveBeenCalled());
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const commands = batchSpy.mock.calls[0]?.[0];
    if (!commands) throw new Error("batchSpy not called");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      type: "config:write:set",
      payload: { key: "demo:config:site-name", value: "Globex", scope: "tenant" },
    });
  });

  test("save-button disabled after successful submit (rebase fired)", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { "demo:config:site-name": { value: "Acme", scope: "tenant" } },
      })) as unknown as Dispatcher["query"],
      batch: (async () => ({
        isSuccess: true,
        results: [],
      })) as unknown as Dispatcher["batch"],
    });

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const siteInput = screen.getByTestId("field-siteName").querySelector("input");
    if (!siteInput) throw new Error("expected siteName input");

    await user.clear(siteInput);
    await user.type(siteInput, "Globex");
    const submit = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    await user.click(submit);

    // After rebase, draft == server-snapshot, isUnchanged=true,
    // Button wird disabled. Ohne customSubmit-rebase-Wiring blieb
    // dieser State stale (regression-guard).
    await waitFor(() => expect(submit.disabled).toBe(true));
  });

  // Regression Bug-Bash-2 (2026-06-08): RenderEdit reichte denselben
  // Appendix-Callback als labelAppendix UND fieldAppendix durch —
  // Badge + Standard-Disclosure erschienen doppelt (vor und nach dem
  // Input) auf jedem Settings-Screen mit Default-Werten.
  test("Source-Badge und Standard-Disclosure erscheinen genau einmal pro Feld", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (qn: string) => {
        if (qn === "config:query:cascade") {
          return {
            isSuccess: true,
            data: {
              "demo:config:site-name": {
                value: "Acme",
                source: "tenant-row",
                levels: [
                  {
                    source: "tenant-row",
                    label: "tenant-row",
                    value: "Acme",
                    isActive: true,
                    hasValue: true,
                  },
                  {
                    source: "default",
                    label: "default",
                    value: "fallback",
                    isActive: false,
                    hasValue: true,
                  },
                ],
              },
            },
          };
        }
        return {
          isSuccess: true,
          data: {
            "demo:config:site-name": { value: "Acme", scope: "tenant", source: "tenant-row" },
          },
        };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );
    await waitFor(() => screen.getByTestId("render-edit-form"));
    const field = screen.getByTestId("field-siteName");
    await waitFor(() =>
      expect(field.querySelectorAll('[data-testid="config-cascade"]')).toHaveLength(1),
    );
    // Eine einzige Status-Stelle pro Feld: die Cascade-Disclosure unter dem
    // Input trägt Quelle + Wert. Das frühere Label-Badge war redundant und
    // wurde entfernt (User-Feedback "2× Fehlt").
    expect(field.querySelectorAll('[data-testid="config-source-badge"]')).toHaveLength(0);
    const label = field.querySelector("label");
    expect(label?.querySelector('[data-testid="config-source-badge"]')).toBeNull();
    expect(label?.querySelector('[data-testid="config-cascade"]')).toBeNull();
  });
});
