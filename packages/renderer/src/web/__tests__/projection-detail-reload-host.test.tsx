import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import type { ExtensionSectionProps, FeatureSchema } from "../../index.ts";
import { DispatcherProvider, ExtensionSectionsProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

function ReloadingSection({ reloadHost }: ExtensionSectionProps): ReactNode {
  return (
    <button type="button" data-testid="reload-host" onClick={() => reloadHost?.()}>
      reload
    </button>
  );
}

const screenWithSlots: ProjectionDetailScreenDefinition = {
  id: "session-detail",
  type: "projectionDetail",
  query: "sessions:query:user-session:detail",
  idParam: "id",
  layout: {
    sections: [
      {
        kind: "extension",
        title: "Signature",
        component: { react: { __component: "ReloadingSection" } },
        entityName: "user-session",
      },
    ],
  },
};

describe("ExtensionSectionProps.reloadHost in projectionDetail", () => {
  test("an extension section can refetch the host detail query", async () => {
    let detailFetches = 0;
    const dispatcher: Dispatcher = createMockDispatcher({
      query: async () => {
        detailFetches += 1;
        return { isSuccess: true, data: { userId: `user-${detailFetches}` } };
      },
    });
    const schema: FeatureSchema = {
      featureName: "sessions",
      entities: {},
      screens: [screenWithSlots],
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <ExtensionSectionsProvider value={{ ReloadingSection }}>
          <KumikoScreen schema={schema} qn="sessions:screen:session-detail" entityId="sess-1" />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const button = await waitFor(() => screen.getByTestId("reload-host"));
    expect(detailFetches).toBe(1);
    fireEvent.click(button);
    await waitFor(() => expect(detailFetches).toBe(2));
  });
});
