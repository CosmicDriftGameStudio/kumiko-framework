// A multiSelect field with `optionsQuery` on an actionForm loads its checkable options from a
// query handler, re-loads when a `{ field }` sibling changes and drops values the new rows lack.

import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const SCOPES_QUERY = "demo:query:scope-candidates";

const grantScreen: ActionFormScreenDefinition = {
  id: "grant",
  type: "actionForm",
  handler: "demo:write:grant",
  fields: {
    kind: { type: "select", options: ["staff", "owner"], display: "dropdown" },
    scopes: {
      type: "multiSelect",
      options: [],
      display: "checkboxes",
      optionsQuery: SCOPES_QUERY,
      optionsQueryPayload: { kind: { field: "kind" }, portal: "tenant" },
    },
  },
  layout: { sections: [{ title: "Grant", fields: ["kind", "scopes"] }] },
};

const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [grantScreen] };

function makeDispatcher() {
  const queryPayloads: Record<string, unknown>[] = [];
  const writes: { type: string; payload: unknown }[] = [];
  const dispatcher = createMockDispatcher({
    query: async (qn: string, payload: unknown) => {
      if (qn !== SCOPES_QUERY) return { isSuccess: true, data: {} };
      const asked: Record<string, unknown> =
        typeof payload === "object" && payload !== null ? { ...payload } : {};
      queryPayloads.push(asked);
      const rows =
        asked["kind"] === "owner"
          ? [
              { value: "lease-1", label: "Lease 1" },
              { value: "lease-3", label: "Lease 3" },
            ]
          : [
              { value: "lease-1", label: "Lease 1" },
              { value: "lease-2", label: "Lease 2" },
            ];
      return { isSuccess: true, data: { rows } };
    },
    write: async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: {} };
    },
  });
  return { dispatcher, queryPayloads, writes };
}

async function renderGrant() {
  const harness = makeDispatcher();
  const user = userEvent.setup();
  render(
    <DispatcherProvider dispatcher={harness.dispatcher}>
      <KumikoScreen schema={schema} qn="demo:screen:grant" />
    </DispatcherProvider>,
  );
  await waitFor(() => screen.getByTestId("render-edit-form"));
  return { ...harness, user };
}

async function chooseKind(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByTestId("combobox-kumiko-edit-kind"));
  await user.click(await screen.findByText(label));
}

describe("multiSelect optionsQuery on an actionForm", () => {
  test("queries with the resolved payload and lists the returned rows as checkboxes", async () => {
    const { user, queryPayloads } = await renderGrant();
    await chooseKind(user, "staff");

    await waitFor(() => expect(queryPayloads.at(-1)).toEqual({ kind: "staff", portal: "tenant" }));
    await screen.findByRole("checkbox", { name: "Lease 1" });
    await screen.findByRole("checkbox", { name: "Lease 2" });
  });

  test("submitting writes the checked values", async () => {
    const { user, writes } = await renderGrant();
    await chooseKind(user, "staff");
    await user.click(await screen.findByRole("checkbox", { name: "Lease 1" }));
    await user.click(await screen.findByRole("checkbox", { name: "Lease 2" }));
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]?.type).toBe("demo:write:grant");
    expect(writes[0]?.payload).toMatchObject({ scopes: ["lease-1", "lease-2"] });
  });

  test("changing the sibling reloads and drops values the new rows no longer contain", async () => {
    const { user, queryPayloads, writes } = await renderGrant();
    await chooseKind(user, "staff");
    await user.click(await screen.findByRole("checkbox", { name: "Lease 1" }));
    await user.click(await screen.findByRole("checkbox", { name: "Lease 2" }));

    await chooseKind(user, "owner");
    await waitFor(() => expect(queryPayloads.at(-1)).toEqual({ kind: "owner", portal: "tenant" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Lease 2" })).toBeNull());
    screen.getByRole("checkbox", { name: "Lease 1" });

    await user.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]?.payload).toMatchObject({ scopes: ["lease-1"] });
  });
});
