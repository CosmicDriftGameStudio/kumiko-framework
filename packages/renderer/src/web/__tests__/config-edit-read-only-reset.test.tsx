// A read-only layout field keeps its cascade status but offers no "reset override" button.

import { describe, expect, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor, within } from "./test-utils.tsx";

const screenDefinition: ConfigEditScreenDefinition = {
  id: "plan",
  type: "configEdit",
  scope: "tenant",
  configKeys: { planName: "demo:config:plan-name", note: "demo:config:note" },
  fields: {
    planName: { type: "text" },
    note: { type: "text" },
    // @cast-boundary inline schema-author shape — FieldDefinition union too narrow
  } as ConfigEditScreenDefinition["fields"],
  layout: {
    sections: [{ title: "Plan", fields: [{ field: "planName", readOnly: true }, "note"] }],
  },
};

const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [screenDefinition] };

function overriddenCascade(value: string): unknown {
  return {
    value,
    source: "tenant-row",
    levels: [
      { source: "tenant-row", label: "tenant-row", value, isActive: true, hasValue: true },
      { source: "default", label: "default", value: "x", isActive: false, hasValue: true },
    ],
  };
}

describe("configEdit read-only field cascade", () => {
  test("no reset button on a read-only field, the editable one keeps it", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (qn: string) => {
        if (qn === "config:query:cascade") {
          return {
            isSuccess: true,
            data: {
              "demo:config:plan-name": overriddenCascade("Pro"),
              "demo:config:note": overriddenCascade("Hi"),
            },
          };
        }
        return {
          isSuccess: true,
          data: {
            "demo:config:plan-name": { value: "Pro", scope: "tenant", source: "tenant-row" },
            "demo:config:note": { value: "Hi", scope: "tenant", source: "tenant-row" },
          },
        };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:plan" />
      </DispatcherProvider>,
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId("field-note")).queryByTestId("config-cascade-reset"),
      ).not.toBeNull(),
    );
    const readOnlyField = screen.getByTestId("field-planName");
    expect(within(readOnlyField).queryByTestId("config-cascade")).not.toBeNull();
    expect(within(readOnlyField).queryByTestId("config-cascade-reset")).toBeNull();
  });
});
