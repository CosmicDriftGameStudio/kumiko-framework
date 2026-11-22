import { describe, expect, mock, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

type Redirect = Exclude<ActionFormScreenDefinition["redirect"], string | undefined>;

function makeScreen(redirect: Redirect): ActionFormScreenDefinition {
  return {
    id: "send",
    type: "actionForm",
    handler: "demo:write:send",
    fields: { name: { type: "text", required: true } },
    layout: { sections: [{ fields: ["name"] }] },
    redirect,
    successFacts: [{ field: "sent", label: "demo.fact.sent" }],
  } as unknown as ActionFormScreenDefinition;
}

const CMD_REDIRECT: Redirect = {
  screen: "cockpit",
  searchParams: { cmd: "commandId" },
  onlyWith: "commandId",
};

const LABELS: Readonly<Record<string, string>> = {
  "demo.fact.sent": "Sent",
  "kumiko.actionForm.success": "Done.",
};

async function submitWith(
  redirect: Redirect,
  data: Record<string, unknown>,
): Promise<ReturnType<typeof mock>> {
  const send = makeScreen(redirect);
  const schema: FeatureSchema = {
    featureName: "demo",
    entities: {},
    screens: [send, { id: "cockpit", type: "custom" }] as unknown as FeatureSchema["screens"],
  };
  const navigate = mock((_target: unknown) => {});
  render(
    <DispatcherProvider
      dispatcher={createMockDispatcher({ write: async () => ({ isSuccess: true, data }) })}
    >
      <NavProvider
        value={{
          route: { screenId: "demo:screen:send" },
          navigate,
          replace: () => {},
          hrefFor: () => "#",
          searchParams: {},
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={schema}
          qn="demo:screen:send"
          translate={(key) => LABELS[key] ?? key}
        />
      </NavProvider>
    </DispatcherProvider>,
  );
  await waitFor(() => screen.getByTestId("render-edit-form"));
  const input = screen.getByTestId("field-name").querySelector("input");
  if (!input) throw new Error("expected a name input");
  const user = userEvent.setup();
  await user.type(input, "x");
  await user.click(screen.getByTestId("render-edit-submit"));
  return navigate;
}

describe("actionForm redirect.onlyWith", () => {
  test("navigates with the search param when the payload field is set", async () => {
    const navigate = await submitWith(CMD_REDIRECT, { commandId: "cmd-1", sent: 1 });
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(JSON.stringify(navigate.mock.calls[0])).toContain("cmd-1");
    expect(screen.queryByTestId("action-form-success")).toBeNull();
  });

  test("stays put and shows the success box when the payload field is missing", async () => {
    const navigate = await submitWith(CMD_REDIRECT, { sent: 3 });
    await waitFor(() => screen.getByTestId("action-form-success"));
    expect(screen.getByText("Sent").nextElementSibling?.textContent).toBe("3");
    expect(navigate).not.toHaveBeenCalled();
  });

  test("an empty string counts as missing", async () => {
    const navigate = await submitWith(CMD_REDIRECT, { commandId: "", sent: 3 });
    await waitFor(() => screen.getByTestId("action-form-success"));
    expect(navigate).not.toHaveBeenCalled();
  });

  test("without onlyWith the redirect fires even when the payload field is missing", async () => {
    const navigate = await submitWith(
      { screen: "cockpit", searchParams: { cmd: "commandId" } },
      {
        sent: 3,
      },
    );
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(screen.queryByTestId("action-form-success")).toBeNull();
  });
});
