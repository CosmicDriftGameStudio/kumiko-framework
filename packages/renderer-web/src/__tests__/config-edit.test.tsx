//
// Unit-Tests für den configEdit-Screen-Type. Decken die Pfade ab die
// Integration + E2E nur indirekt sehen:
//   - Initial-Load via config:query:values + Pre-Fill aus values[qn]
//   - customSubmit dispatcht pro geändertem Field einen separaten
//     config:write:set Call mit dem qualifizierten Key + scope
//   - Save-Button Greying via controller.rebase nach Success
//   - Loading-State während config:query:values noch läuft
//
// `as unknown as Dispatcher["query"/"batch"]` throughout: each inline mock
// lambda only implements the one overload a given test exercises, never the
// full overloaded Dispatcher signature — the missing overloads are never
// called at runtime.

import { describe, expect, mock, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.js";

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

// A money-typed field is a legitimate FieldDefinition (screen.fields reuses
// the entity field-shape, kumiko-framework#1923 render-field.tsx money case)
// even though ConfigKeyType (write-helpers.ts) never carries "money" — the
// server side of a config key is always a bare scalar.
const moneySettingsScreen: ConfigEditScreenDefinition = {
  id: "money-settings",
  type: "configEdit",
  scope: "tenant",
  configKeys: { priceLimit: "demo:config:price-limit" },
  fields: {
    priceLimit: { type: "money" },
    // @cast-boundary inline schema-author shape — FieldDefinition union too narrow
  } as ConfigEditScreenDefinition["fields"],
  layout: { sections: [{ title: "Basics", fields: ["priceLimit"] }] },
};

const moneySchema: FeatureSchema = {
  featureName: "demo",
  entities: {},
  screens: [moneySettingsScreen],
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

  test("dirty footer: counts changed fields, Discard restores the loaded values client-side", async () => {
    const batchSpy = mock(async () => ({ isSuccess: true as const, results: [] }));
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
    const status = () => document.querySelector("[data-testid$='-unsaved']")?.textContent ?? "";
    expect(status()).toContain("No unsaved changes");
    expect(screen.queryByTestId("render-edit-discard")).toBeNull();

    const siteInput = screen
      .getByTestId("field-siteName")
      .querySelector("input") as HTMLInputElement;
    const maxInput = screen
      .getByTestId("field-maxUploadMb")
      .querySelector("input") as HTMLInputElement;
    await user.clear(siteInput);
    await user.type(siteInput, "Other");
    await user.clear(maxInput);
    await user.type(maxInput, "30");
    expect(status()).toContain("2 unsaved changes");
    expect(screen.getByTestId("render-edit-submit").textContent).toBe("Save changes");

    await user.click(screen.getByTestId("render-edit-discard"));
    expect(
      (screen.getByTestId("field-siteName").querySelector("input") as HTMLInputElement).value,
    ).toBe("Acme");
    expect(
      (screen.getByTestId("field-maxUploadMb").querySelector("input") as HTMLInputElement).value,
    ).toBe("25");
    expect(status()).toContain("No unsaved changes");
    expect(batchSpy).not.toHaveBeenCalled();
  });

  test("out-of-bounds value shows the field message while typing; Save stays enabled and blocks on submit", async () => {
    const boundedScreen: ConfigEditScreenDefinition = {
      ...settingsScreen,
      fields: {
        siteName: { type: "text", required: true },
        maxUploadMb: { type: "number", min: 1, max: 1000 },
        // @cast-boundary inline schema-author shape — FieldDefinition union too narrow
      } as ConfigEditScreenDefinition["fields"],
    };
    const boundedSchema: FeatureSchema = {
      featureName: "demo",
      entities: {},
      screens: [boundedScreen],
    };
    const batchSpy = mock(async () => ({ isSuccess: true as const, results: [] }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { "demo:config:max-upload-mb": { value: 25, scope: "tenant" } },
      })) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={boundedSchema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );
    await waitFor(() => screen.getByTestId("render-edit-form"));
    const maxInput = screen
      .getByTestId("field-maxUploadMb")
      .querySelector("input") as HTMLInputElement;
    await user.clear(maxInput);
    await user.type(maxInput, "5000");
    const submit = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    // Message stands at the field right after typing, before any submit.
    expect(screen.getByTestId("field-maxUploadMb-errors").textContent).toBe(
      "Must be 1000 or less.",
    );
    await user.clear(maxInput);
    await user.type(maxInput, "0");
    expect(screen.getByTestId("field-maxUploadMb-errors").textContent).toBe("Must be at least 1.");
    await user.clear(maxInput);
    await user.type(maxInput, "5000");
    await user.click(submit);
    expect(batchSpy).not.toHaveBeenCalled();
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

  // kumiko-framework#1923: RenderField's money case now always emits the
  // entityEdit `{amount, currency}` payload shape. A config key's server
  // value is always a bare scalar (ConfigKeyType has no "money" variant) —
  // customSubmit must unwrap back to `.amount` before dispatching, or the
  // batch's config:write:set value fails its `string | number | boolean`
  // schema entirely (regression guard for that unwrap).
  test("money field submit unwraps {amount, currency} back to a bare number", async () => {
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: true as const,
      results: [],
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { "demo:config:price-limit": { value: 12.99, scope: "tenant" } },
      })) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={moneySchema} qn="demo:screen:money-settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const priceInput = screen.getByTestId("field-priceLimit").querySelector("input");
    if (!priceInput) throw new Error("expected priceLimit input");

    await user.clear(priceInput);
    await user.type(priceInput, "15.00");
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(batchSpy).toHaveBeenCalled());
    const commands = batchSpy.mock.calls[0]?.[0];
    if (!commands) throw new Error("batchSpy not called");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      type: "config:write:set",
      payload: { key: "demo:config:price-limit", value: 15, scope: "tenant" },
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

  // Regression #430: nach "Speichern" zeigte die Cascade-Disclosure den
  // alten Wert bis zum Page-Reload — customSubmit rebased nur den Form-State
  // (controller.rebase), refetchte aber values/cascade NICHT (onReset tat es).
  // Guard: nach erfolgreichem Save MUSS jede der beiden Queries erneut laufen.
  test("save refetcht values + cascade — Disclosure nach Speichern aktuell, nicht erst nach Reload", async () => {
    const queryCalls: Record<string, number> = {};
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (qn: string) => {
        queryCalls[qn] = (queryCalls[qn] ?? 0) + 1;
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
      batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    });

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const cascadeBefore = queryCalls["config:query:cascade"] ?? 0;
    const valuesBefore = queryCalls["config:query:values"] ?? 0;

    const siteInput = screen.getByTestId("field-siteName").querySelector("input");
    if (!siteInput) throw new Error("expected siteName input");
    await user.clear(siteInput);
    await user.type(siteInput, "Globex");
    await user.click(screen.getByTestId("render-edit-submit"));

    // Ohne den refetch im customSubmit bleiben beide Counts flat (rot).
    await waitFor(() => {
      expect(queryCalls["config:query:cascade"] ?? 0).toBeGreaterThan(cascadeBefore);
    });
    expect(queryCalls["config:query:values"] ?? 0).toBeGreaterThan(valuesBefore);
  });

  // #432/1: the cascade disclosure button (below the input) opens and closes
  // the level panel; the open/close cycle is pinned here as an interaction.
  test("#432/1: cascade disclosure toggles the level panel open and closed", async () => {
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
                  {
                    source: "system-row",
                    label: "system-row",
                    value: "platform",
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

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const field = screen.getByTestId("field-siteName");
    await waitFor(() =>
      expect(field.querySelector('[data-testid="config-cascade"]')).not.toBeNull(),
    );

    // collapsed: panel is absent → the inactive default level ("fallback")
    // is not in the DOM (the trigger only shows the active value "Acme").
    expect(screen.queryByText("fallback")).toBeNull();

    // below-control: the cascade sits after the input so inputs stay on one line.
    const input = field.querySelector("input");
    const cascade = field.querySelector('[data-testid="config-cascade"]');
    if (!input || !cascade) throw new Error("input or cascade missing");
    expect(input.compareDocumentPosition(cascade) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const toggle = screen.getByRole("button", { name: "Show all levels" });

    // open → panel renders all levels incl. the inactive default value
    await user.click(toggle);
    await waitFor(() => expect(screen.getByText("fallback")).toBeTruthy());

    // close → panel gone again
    await user.click(toggle);
    await waitFor(() => expect(screen.queryByText("fallback")).toBeNull());
  });

  test("a changed field gets the changed marker, an untouched one does not", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { "demo:config:site-name": { value: "Acme", scope: "tenant" } },
      })) as unknown as Dispatcher["query"],
    });
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(screen.queryByTestId("field-siteName-changed")).toBeNull();
    const siteInput = screen.getByTestId("field-siteName").querySelector("input");
    if (!siteInput) throw new Error("site name input not found");
    await user.type(siteInput, "!");
    await waitFor(() => expect(screen.getByTestId("field-siteName-changed")).toBeTruthy());
    expect(screen.queryByTestId("field-maxUploadMb-changed")).toBeNull();
  });

  test("fieldDescriptions render as help text under the label", async () => {
    const describedSchema: FeatureSchema = {
      featureName: "demo",
      entities: {},
      screens: [
        { ...settingsScreen, fieldDescriptions: { siteName: "Shown in the browser tab." } },
      ],
    };
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={describedSchema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(screen.getByTestId("field-siteName-description").textContent).toBe(
      "Shown in the browser tab.",
    );
    expect(screen.queryByTestId("field-maxUploadMb-description")).toBeNull();
  });

  test("a failed values query shows the error with a retry that refetches", async () => {
    let calls = 0;
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => {
        calls += 1;
        if (calls === 1) {
          return {
            isSuccess: false,
            error: { code: "BOOM", httpStatus: 500, i18nKey: "errors.boom", message: "boom" },
          };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("kumiko-screen-error"));
    await user.click(screen.getByTestId("kumiko-screen-retry"));
    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(screen.queryByTestId("kumiko-screen-error")).toBeNull();
  });
});

describe("KumikoScreen / configEdit bounds and row alignment", () => {
  const boundedScreen: ConfigEditScreenDefinition = {
    ...settingsScreen,
    fields: {
      siteName: { type: "text", required: true },
      maxUploadMb: { type: "number", min: 1, max: 1000 },
      // @cast-boundary inline schema-author shape — FieldDefinition union too narrow
    } as ConfigEditScreenDefinition["fields"],
  };
  const boundedSchema: FeatureSchema = {
    featureName: "demo",
    entities: {},
    screens: [boundedScreen],
  };

  test("a number above its max is rejected on the field and never written", async () => {
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: true as const,
      results: [],
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { "demo:config:max-upload-mb": { value: 25, scope: "tenant" } },
      })) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={boundedSchema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const input = screen.getByTestId("field-maxUploadMb").querySelector("input");
    if (!input) throw new Error("max upload input not found");
    await user.clear(input);
    await user.type(input, "5000");
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("field-maxUploadMb").textContent).toContain("Must be 1000 or less"),
    );
    expect(batchSpy).not.toHaveBeenCalled();
  });

  test("a row with a below-control appendix aligns its cells to the top", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (qn: string) =>
        qn === "config:query:cascade"
          ? {
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
                  ],
                },
              },
            }
          : { isSuccess: true, data: {} }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={boundedSchema} qn="demo:screen:settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const field = screen.getByTestId("field-siteName");
    await waitFor(() => expect(field.hasAttribute("data-appendix-below")).toBe(true));
    expect(screen.getByTestId("field-maxUploadMb").hasAttribute("data-appendix-below")).toBe(false);
    const row = field.closest('[class*="has-[[data-appendix-below]]:items-start"]');
    expect(row).not.toBeNull();
  });
});
