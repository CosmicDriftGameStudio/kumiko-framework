import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  DispatcherProvider,
  ExtensionSectionsProvider,
  KumikoScreen,
  useExtensionFormSubmit,
} from "../../index.ts";
import { act, createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

function SelfSavingNotes(): ReactNode {
  const composed = useExtensionFormSubmit({
    dirty: true,
    onSubmit: async () => ({ isSuccess: true }),
  });
  return <span data-testid="self-saving-composed">{String(composed)}</span>;
}

const detailScreen: ProjectionDetailScreenDefinition = {
  id: "session-detail",
  type: "projectionDetail",
  query: "sessions:query:user-session:detail",
  idParam: "id",
  layout: { sections: [] },
};

const selfSavingScreen: ProjectionDetailScreenDefinition = {
  ...detailScreen,
  layout: {
    sections: [
      {
        kind: "extension",
        title: "Notes",
        component: { react: { __component: "SelfSavingNotes" } },
        entityName: "user-session",
      },
    ],
  },
};

describe("KumikoScreen / projectionDetail extension and the page Save", () => {
  test("a self-saving extension asks for the form host but keeps its own save and gets no page Save", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: async () => ({
        isSuccess: true,
        data: { userId: "user-42", createdAt: "2026-07-01T00:00:00Z" },
      }),
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <ExtensionSectionsProvider value={{ SelfSavingNotes }}>
          <KumikoScreen
            schema={{ featureName: "sessions", entities: {}, screens: [selfSavingScreen] }}
            qn="sessions:screen:session-detail"
            entityId="sess-1"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const composed = await waitFor(() => screen.getByTestId("self-saving-composed"));
    expect(composed.textContent).toBe("false");
    expect(screen.queryByTestId("render-edit-submit")).toBeNull();
  });

  test("a layout of only an extension section that registers with the form host still gets its Save, which runs the extension's submit", async () => {
    const submitted: string[] = [];
    // biome-ignore lint/correctness/noComponentHookFactories: closes over the test-local submitted array; defined once per test run, never during a render
    function RegisteringNotes({ entityId }: { entityId: string | null }): ReactNode {
      const [dirty, setDirty] = useState(false);
      useExtensionFormSubmit({
        dirty,
        onSubmit: async (ctx) => {
          submitted.push(ctx.entityId);
          return { isSuccess: true };
        },
      });
      return (
        <button type="button" data-testid="notes-touch" onClick={() => setDirty(true)}>
          {entityId}
        </button>
      );
    }
    const extensionOnlyScreen: ProjectionDetailScreenDefinition = {
      ...detailScreen,
      layout: {
        sections: [
          {
            kind: "extension",
            title: "Notes",
            component: { react: { __component: "RegisteringNotes" } },
            contributesToFormSubmit: true,
            entityName: "user-session",
          },
        ],
      },
    };
    const extensionOnlySchema: FeatureSchema = {
      featureName: "sessions",
      entities: {},
      screens: [extensionOnlyScreen],
    };
    const dispatcher: Dispatcher = createMockDispatcher({
      query: async () => ({
        isSuccess: true,
        data: { userId: "user-42", createdAt: "2026-07-01T00:00:00Z" },
      }),
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <ExtensionSectionsProvider value={{ RegisteringNotes }}>
          <KumikoScreen
            schema={extensionOnlySchema}
            qn="sessions:screen:session-detail"
            entityId="sess-1"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("notes-touch"));
    const submit = await waitFor(() => screen.getByTestId("render-edit-submit"));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("notes-touch"));
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
    });
    await waitFor(() => expect(submitted).toEqual(["sess-1"]));
  });

  test.each([
    ["its errorKey", "sessions.errors.notes-failed", "sessions.errors.notes-failed"],
    [
      "the generic save-failed key when none is given",
      undefined,
      "A custom field could not be saved.",
    ],
  ])(
    "a failing extension submit shows the banner with %s",
    async (_label, errorKey, expectedText) => {
      // biome-ignore lint/correctness/noComponentHookFactories: closes over the test.each errorKey parameter; defined once per test run, never during a render
      function RegisteringNotes({ entityId }: { entityId: string | null }): ReactNode {
        const [dirty, setDirty] = useState(false);
        useExtensionFormSubmit({
          dirty,
          onSubmit: async (ctx) => {
            void ctx;
            return { isSuccess: false, ...(errorKey !== undefined && { errorKey }) };
          },
        });
        return (
          <button type="button" data-testid="notes-touch" onClick={() => setDirty(true)}>
            {entityId}
          </button>
        );
      }
      const extensionOnlyScreen: ProjectionDetailScreenDefinition = {
        ...detailScreen,
        layout: {
          sections: [
            {
              kind: "extension",
              title: "Notes",
              component: { react: { __component: "RegisteringNotes" } },
              contributesToFormSubmit: true,
              entityName: "user-session",
            },
          ],
        },
      };
      const extensionOnlySchema: FeatureSchema = {
        featureName: "sessions",
        entities: {},
        screens: [extensionOnlyScreen],
      };
      const dispatcher: Dispatcher = createMockDispatcher({
        query: async () => ({
          isSuccess: true,
          data: { userId: "user-42", createdAt: "2026-07-01T00:00:00Z" },
        }),
      });

      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <ExtensionSectionsProvider value={{ RegisteringNotes }}>
            <KumikoScreen
              schema={extensionOnlySchema}
              qn="sessions:screen:session-detail"
              entityId="sess-1"
            />
          </ExtensionSectionsProvider>
        </DispatcherProvider>,
      );

      await waitFor(() => screen.getByTestId("notes-touch"));
      const submit = await waitFor(() => screen.getByTestId("render-edit-submit"));
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByTestId("notes-touch"));
      await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
      await act(async () => {
        fireEvent.submit(screen.getByTestId("render-edit-form"));
      });
      const banner = await waitFor(() => screen.getByTestId("render-edit-extension-error-key"));
      expect(banner.textContent).toBe(expectedText);
    },
  );
});
