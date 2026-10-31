import { describe, expect, mock, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const UPLOAD = {
  id: "upload",
  type: "actionForm",
  handler: "demo:write:upload",
  fields: { name: { type: "text", required: true } },
  layout: { sections: [{ fields: ["name"] }] },
  successItems: {
    field: "results",
    link: { screen: "cockpit", params: { cmd: "commandId" }, label: "demo.open" },
  },
  resetOnSuccess: true,
} as unknown as ActionFormScreenDefinition;

const SCHEMA: FeatureSchema = {
  featureName: "demo",
  entities: {},
  screens: [UPLOAD, { id: "cockpit", type: "custom" }] as unknown as FeatureSchema["screens"],
};

const LABELS: Readonly<Record<string, string>> = { "demo.open": "Open" };

function renderUpload(
  screenDefinition: ActionFormScreenDefinition,
  data: Record<string, unknown>,
  navigate: (...args: unknown[]) => void = () => {},
) {
  const dispatcher = createMockDispatcher({
    write: (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["write"],
  });
  return render(
    <DispatcherProvider dispatcher={dispatcher}>
      <NavProvider
        value={{
          route: { screenId: "demo:screen:upload" },
          navigate,
          replace: () => {},
          hrefFor: () => "#",
          searchParams: {},
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={{ ...SCHEMA, screens: [screenDefinition, ...SCHEMA.screens.slice(1)] }}
          qn="demo:screen:upload"
          translate={(key) => LABELS[key] ?? key}
        />
      </NavProvider>
    </DispatcherProvider>,
  );
}

async function submit(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
  const input = screen.getByTestId("field-name").querySelector("input");
  if (!input) throw new Error("expected a name input");
  const user = userEvent.setup();
  await user.type(input, "scan.pdf");
  await user.click(screen.getByTestId("render-edit-submit"));
}

describe("actionForm successItems", () => {
  test("shows one hint per entry instead of the generic confirmation", async () => {
    renderUpload(UPLOAD, {
      results: [
        { label: "a.pdf is in the inbox now.", commandId: "c-1" },
        { label: "b.pdf was already there.", commandId: "c-2" },
      ],
    });
    await submit();

    await waitFor(() => expect(screen.getByTestId("action-form-success-items")).toBeTruthy());
    expect(screen.getByTestId("action-form-success-item-0").textContent).toContain(
      "a.pdf is in the inbox now.",
    );
    expect(screen.getByTestId("action-form-success-item-1").textContent).toContain(
      "b.pdf was already there.",
    );
    expect(screen.queryByTestId("action-form-success")).toBeNull();
    expect(document.body.textContent).not.toContain("kumiko.actionForm.success");
  });

  test("each hint's link reads its params from its own entry", async () => {
    const navigate = mock(() => {});
    renderUpload(
      UPLOAD,
      {
        results: [
          { label: "a.pdf", commandId: "c-1" },
          { label: "b.pdf", commandId: "c-2" },
        ],
      },
      navigate,
    );
    await submit();
    await waitFor(() => expect(screen.getByTestId("action-form-success-item-1-link")).toBeTruthy());

    expect(screen.getByTestId("action-form-success-item-1-link").textContent).toBe("Open");
    await userEvent.setup().click(screen.getByTestId("action-form-success-item-1-link"));

    expect(navigate).toHaveBeenCalledWith(
      { screenId: "cockpit" },
      { searchParams: { cmd: "c-2" } },
    );
  });

  test("an entry whose link does not resolve keeps its hint without a link", async () => {
    renderUpload(UPLOAD, { results: [{ label: "a.pdf" }, { commandId: "c-9" }] });
    await submit();

    await waitFor(() => expect(screen.getByTestId("action-form-success-item-0")).toBeTruthy());
    expect(screen.queryByTestId("action-form-success-item-0-link")).toBeNull();
    expect(screen.queryByTestId("action-form-success-item-1")).toBeNull();
  });

  test("without any shown entry the generic confirmation stays", async () => {
    renderUpload(UPLOAD, { results: [] });
    await submit();

    await waitFor(() => expect(screen.getByTestId("action-form-success-text")).toBeTruthy());
    expect(screen.queryByTestId("action-form-success-items")).toBeNull();
  });
});
