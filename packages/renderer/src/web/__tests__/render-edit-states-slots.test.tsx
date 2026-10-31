import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import * as z from "zod";
import type { Dispatcher, FormSnapshot, SubmitResult } from "../../headless/index.ts";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  DraftStorageProvider,
  ExtensionSectionsProvider,
  LocaleProvider,
  RenderEdit,
  type RenderEditChangeState,
  type RenderEditControls,
} from "../../index.ts";
import {
  makeDispatcher,
  makeScreen,
  orderEntity,
  type TestValues,
} from "./_render-edit-helpers.tsx";
import {
  act,
  createFakeDraftStorage,
  createMockDispatcher,
  fireEvent,
  render,
  renderWithPrimitivesOverride,
  screen,
  waitFor,
  within,
} from "./test-utils.tsx";

describe("RenderEdit locked state", () => {
  test("disabled renders every field inactive and the submit button inactive", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
          disabled
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input");
    expect((titleInput as HTMLInputElement).disabled).toBe(true);
    const countInput = screen.getByTestId("field-count").querySelector("input");
    expect((countInput as HTMLInputElement).disabled).toBe(true);
    const urgentSwitch = screen.getByTestId("field-isUrgent").querySelector('[role="switch"]');
    expect((urgentSwitch as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  test("disabled blocks the write even on a direct form submit (Enter key), not just via the button", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
          disabled
        />
      </DispatcherProvider>,
    );

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(write).not.toHaveBeenCalled();
  });

  test("without disabled, fields and submit stay active (existing behaviour unchanged)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input");
    expect((titleInput as HTMLInputElement).disabled).toBe(false);
  });

  test("disabled prevents the Delete button from invoking onDelete", async () => {
    const onDelete = mock(async () => {});
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
          onDelete={onDelete}
          disabled
        />
      </DispatcherProvider>,
    );

    const deleteButton = screen.getByTestId("render-edit-delete") as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    fireEvent.click(deleteButton);
    expect(screen.queryByTestId("render-edit-delete-dialog")).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  test("Delete is in the secondary group, Submit in the primary group", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
          onDelete={async () => {}}
        />
      </DispatcherProvider>,
    );

    const deleteButton = screen.getByTestId("render-edit-delete");
    const submitButton = screen.getByTestId("render-edit-submit");
    expect(deleteButton.closest('[data-testid$="-actions-secondary"]')).not.toBeNull();
    expect(submitButton.closest('[data-testid$="-actions-secondary"]')).toBeNull();
  });

  test("disabled prevents picking a draft candidate from adopting it", async () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard-locked-draftpicker",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        draft: true,
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };
    const candidates = [
      {
        id: `${screenDef.id}:new:draft-1`,
        draftKey: `${screenDef.id}:new:draft-1`,
        stepIndex: 0,
        savedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: `${screenDef.id}:new:draft-2`,
        draftKey: `${screenDef.id}:new:draft-2`,
        stepIndex: 0,
        savedAt: "2026-01-02T00:00:00Z",
      },
    ];
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "form-draft:query:list")
          return { isSuccess: true, data: { drafts: candidates } };
        return { isSuccess: true, data: {} };
      }) as Dispatcher["query"],
      write: (async () => ({ isSuccess: true, data: { id: "1" } })) as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
            disabled
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-draft-picker")).toBeTruthy());
    const pickSecond = screen.getByTestId(`render-edit-draft-pick-${screenDef.id}:new:draft-2`);
    fireEvent.click(pickSecond);

    expect(screen.getByTestId("render-edit-draft-picker")).toBeTruthy();
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput.value).toBe("");
  });
});

describe("RenderEdit hideActions (host-driven action bar)", () => {
  test("hideActions renders the fields but drops RenderEdit's own action bar", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
          hideActions
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("field-title").querySelector("input")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-submit")).toBeNull();
  });

  test("without hideActions, the submit button stays (existing behaviour unchanged)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("render-edit-submit")).toBeTruthy();
  });

  test("controls.submit() writes an unchanged, pre-filled form through customSubmit — the built-in button (disabled while unchanged) cannot do this", async () => {
    const customSubmit = mock(
      async (_snapshot: FormSnapshot<TestValues>): Promise<SubmitResult<unknown>> => ({
        validationBlocked: false,
        isSuccess: true,
        data: { id: "42" },
      }),
    );
    const onSubmit = mock((_result: SubmitResult<unknown>) => {});
    let controls: RenderEditControls<TestValues> | undefined;
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          customSubmit={customSubmit}
          onSubmit={onSubmit}
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    // Nothing was ever edited — the built-in save button proves it by
    // staying disabled. controls.submit() has no such guard and must
    // still write, which is exactly the point of this test.
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      await controls?.submit();
    });

    expect(customSubmit).toHaveBeenCalledTimes(1);
    expect(customSubmit.mock.calls[0]?.[0]?.values).toEqual({
      title: "Acme",
      count: 1,
      isUrgent: false,
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      validationBlocked: false,
      isSuccess: true,
      data: { id: "42" },
    });
  });

  test("onChange's submitting is false on mount", () => {
    const seen: RenderEditChangeState<TestValues>[] = [];
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          writeCommand="order:create"
          onChange={(state) => seen.push(state)}
        />
      </DispatcherProvider>,
    );

    expect(seen.at(-1)?.submitting).toBe(false);
  });

  test("onChange's submitting is true while a customSubmit is in flight and false again after", async () => {
    let resolveSubmit: (() => void) | undefined;
    const customSubmit = mock(
      (_snapshot: FormSnapshot<TestValues>): Promise<SubmitResult<unknown>> =>
        new Promise((resolve) => {
          resolveSubmit = () =>
            resolve({ validationBlocked: false, isSuccess: true, data: { id: "42" } });
        }),
    );
    const seen: RenderEditChangeState<TestValues>[] = [];
    let controls: RenderEditControls<TestValues> | undefined;
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          customSubmit={customSubmit}
          onChange={(state) => seen.push(state)}
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    expect(seen.at(-1)?.submitting).toBe(false);

    let submitPromise: Promise<void> | undefined;
    act(() => {
      submitPromise = controls?.submit();
    });

    expect(seen.at(-1)?.submitting).toBe(true);

    await act(async () => {
      resolveSubmit?.();
      await submitPromise;
    });

    expect(seen.at(-1)?.submitting).toBe(false);
  });

  test("a validation-blocked customSubmit settles in one batch and never emits submitting: true", () => {
    const customSubmit = mock(
      (_snapshot: FormSnapshot<TestValues>): Promise<SubmitResult<unknown>> =>
        Promise.resolve({ validationBlocked: false, isSuccess: true, data: { id: "42" } }),
    );
    const seen: RenderEditChangeState<TestValues>[] = [];
    let controls: RenderEditControls<TestValues> | undefined;
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 1, isUrgent: false }}
          schema={z.object({ title: z.string().min(1), count: z.number(), isUrgent: z.boolean() })}
          customSubmit={customSubmit}
          onChange={(state) => seen.push(state)}
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    act(() => {
      void controls?.submit();
    });

    expect(seen.some((state) => state.submitting)).toBe(false);
    expect(customSubmit).not.toHaveBeenCalled();
  });

  test("a second submit while a customSubmit is in flight is ignored", async () => {
    let resolveSubmit: (() => void) | undefined;
    const customSubmit = mock(
      (_snapshot: FormSnapshot<TestValues>): Promise<SubmitResult<unknown>> =>
        new Promise((resolve) => {
          resolveSubmit = () =>
            resolve({ validationBlocked: false, isSuccess: true, data: { id: "42" } });
        }),
    );
    let controls: RenderEditControls<TestValues> | undefined;
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false }}
          customSubmit={customSubmit}
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    let firstSubmit: Promise<void> | undefined;
    let secondSubmit: Promise<void> | undefined;
    act(() => {
      firstSubmit = controls?.submit();
      secondSubmit = controls?.submit();
    });

    await act(async () => {
      resolveSubmit?.();
      await Promise.all([firstSubmit, secondSubmit]);
    });

    expect(customSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("RenderEdit fields filter", () => {
  const filterEntity = {
    fields: {
      title: { type: "text", required: true },
      count: { type: "number" },
      notes: { type: "text" },
    },
  } as unknown as EntityDefinition;

  function makeTwoSectionScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-edit-filter",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          { title: "Basics", columns: 1, fields: ["title"] },
          { title: "Extra", columns: 2, fields: ["count", "notes"] },
        ],
      },
    };
  }

  type FilterValues = { title: string; count?: number; notes?: string };

  test("fields prop renders only the listed fields; others are absent from the DOM", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<FilterValues>
          screen={makeTwoSectionScreen()}
          entity={filterEntity}
          featureName="orders"
          initial={{ title: "", count: 0, notes: "" }}
          writeCommand="order:create"
          fields={["title"]}
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("field-title")).toBeTruthy();
    expect(screen.queryByTestId("field-count")).toBeNull();
    expect(screen.queryByTestId("field-notes")).toBeNull();
  });

  test("a section with no fields left after filtering renders no section container at all", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<FilterValues>
          screen={makeTwoSectionScreen()}
          entity={filterEntity}
          featureName="orders"
          initial={{ title: "", count: 0, notes: "" }}
          writeCommand="order:create"
          fields={["title"]}
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("section-Basics")).toBeTruthy();
    expect(screen.queryByTestId("section-Extra")).toBeNull();
  });

  test("a schema-required field outside `fields` does not block submit", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    const schema = z.object({
      title: z.string().min(1),
      notes: z.string().min(1),
    });

    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<FilterValues>
          screen={makeTwoSectionScreen()}
          entity={filterEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, notes: "" }}
          writeCommand="order:create"
          schema={schema}
          fields={["title"]}
        />
      </DispatcherProvider>,
    );

    // `notes` is required by the schema and empty, but it's filtered out of
    // the rendered form — the user has no way to fix it, so it must not
    // block the submit.
    expect(screen.queryByTestId("field-notes")).toBeNull();

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
  });

  test("a schema-required field inside `fields` still blocks submit", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    const schema = z.object({
      title: z.string().min(1),
      notes: z.string().min(1),
    });

    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<FilterValues>
          screen={makeTwoSectionScreen()}
          entity={filterEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, notes: "" }}
          writeCommand="order:create"
          schema={schema}
          fields={["title", "notes"]}
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("field-notes")).toBeTruthy();

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(write).not.toHaveBeenCalled();
    expect(screen.getByTestId("field-notes-errors")).toBeTruthy();
  });

  // `fields` naming only unknown field names (typo, renamed field)
  // must not collapse the validation scope to an empty array — an empty
  // scope filters out ALL issues and lets submit through unvalidated.
  test("fields naming only unknown field names falls back to unscoped and still blocks submit", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    const schema = z.object({
      title: z.string().min(1),
      notes: z.string().min(1),
    });

    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<FilterValues>
          screen={makeTwoSectionScreen()}
          entity={filterEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, notes: "" }}
          writeCommand="order:create"
          schema={schema}
          fields={["doesNotExist"]}
        />
      </DispatcherProvider>,
    );

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(write).not.toHaveBeenCalled();
  });
});

function TitleChips({ entityId }: { readonly entityId: string | null }): ReactNode {
  return (
    <span data-testid="title-chips" data-entity-id={entityId ?? "(create)"}>
      3 left
    </span>
  );
}

describe("RenderEdit — slots.titleAction", () => {
  test("titleAction renders in the form title row, next to the title and outside the actions", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ TitleChips }}>
          <RenderEdit<TestValues>
            screen={{
              id: "orders:screen:order-edit-title-action",
              type: "entityEdit",
              entity: "order",
              description: "Edit the order",
              layout: {
                sections: [{ title: "Basics", columns: 1, fields: [{ field: "title" }] }],
              },
              slots: { titleAction: { react: { __component: "TitleChips" } } },
            }}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-1"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const titleAction = screen.getByTestId("render-edit-form-title-action");
    const chips = screen.getByTestId("title-chips");
    expect(titleAction.contains(chips)).toBe(true);
    expect(chips.getAttribute("data-entity-id")).toBe("order-1");
    const titleRow = titleAction.parentElement;
    expect(titleRow?.contains(screen.getByTestId("render-edit-form-title"))).toBe(true);
    expect(
      screen.getByTestId("render-edit-form-actions").querySelector('[data-testid="title-chips"]'),
    ).toBeNull();
  });

  test("titleAction also renders in the chromeless layout (hideSectionTitles)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ TitleChips }}>
          <RenderEdit<TestValues>
            screen={{
              id: "orders:screen:order-edit-title-action-chromeless",
              type: "entityEdit",
              entity: "order",
              description: "Edit the order",
              layout: {
                sections: [{ title: "Basics", columns: 1, fields: [{ field: "title" }] }],
              },
              slots: { titleAction: { react: { __component: "TitleChips" } } },
            }}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-1"
            hideSectionTitles
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const titleAction = screen.getByTestId("render-edit-form-title-action");
    const chips = screen.getByTestId("title-chips");
    expect(titleAction.contains(chips)).toBe(true);
    expect(chips.getAttribute("data-entity-id")).toBe("order-1");
    // Chromeless shell is full-width; the card layout would be max-w-4xl.
    expect(titleAction.closest('[class*="max-w-full"]')).not.toBeNull();
    expect(titleAction.closest('[class*="max-w-4xl"]')).toBeNull();
  });

  test("without titleAction the title row has no action container", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={{
            id: "orders:screen:order-edit-plain-title",
            type: "entityEdit",
            entity: "order",
            description: "Edit the order",
            layout: { sections: [{ title: "Basics", columns: 1, fields: [{ field: "title" }] }] },
          }}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, isUrgent: false }}
          writeCommand="order:update"
          entityId="order-1"
        />
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("render-edit-form-title-action")).toBeNull();
  });
});

function HeaderExtra({ entityId }: { readonly entityId: string | null }): ReactNode {
  return (
    <div data-testid="header-extra" data-entity-id={entityId ?? "(create)"}>
      header extra
    </div>
  );
}

describe("RenderEdit — slots.header", () => {
  function makeHeaderScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-edit-header",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [{ title: "Basics", columns: 1, fields: [{ field: "title" }] }],
      },
      slots: { header: { react: { __component: "HeaderExtra" } } },
    };
  }

  function makeWizardHeaderScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-wizard-header",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
      slots: { header: { react: { __component: "HeaderExtra" } } },
    };
  }

  test("header slot renders above the section content, not in the actions container", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ HeaderExtra }}>
          <RenderEdit<TestValues>
            screen={makeHeaderScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-1"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const header = screen.getByTestId("header-extra");
    const field = screen.getByTestId("field-title");
    expect(Boolean(header.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
    expect(header.getAttribute("data-entity-id")).toBe("order-1");
    expect(
      screen.getByTestId("render-edit-form-actions").querySelector('[data-testid="header-extra"]'),
    ).toBeNull();
  });

  test("header slot stays visible across wizard steps", async () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ HeaderExtra }}>
          <RenderEdit<TestValues>
            screen={makeWizardHeaderScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0 }}
            writeCommand="order:create"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("header-extra")).toBeTruthy();

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(screen.getByTestId("header-extra")).toBeTruthy();
  });

  test("header slot renders before a caller-supplied headerRegion", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ HeaderExtra }}>
          <RenderEdit<TestValues>
            screen={makeHeaderScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-1"
            headerRegion={<div data-testid="host-header-region">host header</div>}
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const header = screen.getByTestId("header-extra");
    const hostRegion = screen.getByTestId("host-header-region");
    expect(
      Boolean(header.compareDocumentPosition(hostRegion) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });
});

function FooterExtra({
  entityId,
  hasUnsavedChanges,
  wizardStep,
}: {
  readonly entityId: string | null;
  readonly hasUnsavedChanges?: boolean;
  readonly wizardStep?: { readonly index: number; readonly isLast: boolean };
}): ReactNode {
  return (
    <button
      type="button"
      data-testid="footer-extra"
      data-entity-id={entityId ?? "(create)"}
      data-dirty={String(hasUnsavedChanges === true)}
      data-step={wizardStep !== undefined ? String(wizardStep.index) : "undefined"}
      data-last={wizardStep !== undefined ? String(wizardStep.isLast) : "undefined"}
    >
      extra
    </button>
  );
}

describe("RenderEdit — slots.footer", () => {
  function makeFooterScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-edit-footer",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [{ title: "Basics", columns: 1, fields: [{ field: "title" }] }],
      },
      slots: { footer: { react: { __component: "FooterExtra" } } },
    };
  }

  function makeWizardFooterScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-wizard-footer",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
      slots: { footer: { react: { __component: "FooterExtra" } } },
    };
  }

  function makeWizardFooterPrimaryScreen(): EntityEditScreenDefinition {
    const screen = makeWizardFooterScreen();
    return { ...screen, slots: { ...screen.slots, footerPrimary: true } };
  }

  async function advanceWizardToLastStep(): Promise<void> {
    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
  }

  // The wizard's submit-type button is pinned above the mobile keyboard
  // and everything else (Back, a footer-slot mount) is demoted to the non-sticky
  // secondary group. A footer-slot action (e.g. a "Publish"
  // button on the last step) that IS meant to be that pinned primary action
  // has no `type="submit"` of its own — `EditSlotMount` wraps it, not a
  // `Button` — so it fell into secondary regardless. `footerPrimary` opts a
  // screen's footer slot into the primary group explicitly.
  test("footerPrimary pins the footer-slot action into the sticky primary group alongside Finish", async () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ FooterExtra }}>
          <RenderEdit<TestValues>
            screen={makeWizardFooterPrimaryScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0 }}
            writeCommand="order:create"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    await advanceWizardToLastStep();
    expect(screen.getByTestId("footer-extra").getAttribute("data-last")).toBe("true");

    const primary = screen.getByTestId("render-edit-form-actions");
    const secondary = screen.getByTestId("render-edit-form-actions-secondary");
    expect(within(primary).getByTestId("footer-extra")).toBeTruthy();
    expect(within(primary).getByTestId("render-edit-submit")).toBeTruthy();
    expect(within(secondary).queryByTestId("footer-extra")).toBeNull();
    expect(within(secondary).getByTestId("render-edit-wizard-back")).toBeTruthy();
    expect(primary.className).toContain("max-sm:fixed");
  });

  test("without footerPrimary the footer-slot action stays in the secondary group", async () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ FooterExtra }}>
          <RenderEdit<TestValues>
            screen={makeWizardFooterScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0 }}
            writeCommand="order:create"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    await advanceWizardToLastStep();
    expect(screen.getByTestId("footer-extra").getAttribute("data-last")).toBe("true");

    const secondary = screen.getByTestId("render-edit-form-actions-secondary");
    expect(within(secondary).getByTestId("footer-extra")).toBeTruthy();
    expect(
      within(screen.getByTestId("render-edit-form-actions")).queryByTestId("footer-extra"),
    ).toBeNull();
  });

  test("renders inside the form actions container, before the submit button", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ FooterExtra }}>
          <RenderEdit<TestValues>
            screen={makeFooterScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-1"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const actions = screen.getByTestId("render-edit-form-actions");
    const footer = within(actions).getByTestId("footer-extra");
    const submit = within(actions).getByTestId("render-edit-submit");
    expect(Boolean(footer.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
  });

  test("hasUnsavedChanges starts false and flips true after a field change", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ FooterExtra }}>
          <RenderEdit<TestValues>
            screen={makeFooterScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-1"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("footer-extra").getAttribute("data-dirty")).toBe("false");

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme Corp" } });

    expect(screen.getByTestId("footer-extra").getAttribute("data-dirty")).toBe("true");
  });

  test("entityId is passed through", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ FooterExtra }}>
          <RenderEdit<TestValues>
            screen={makeFooterScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-77"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("footer-extra").getAttribute("data-entity-id")).toBe("order-77");
  });

  test("wizardStep reflects the current step and last-step flag, and advances on Next", async () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ FooterExtra }}>
          <RenderEdit<TestValues>
            screen={makeWizardFooterScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0 }}
            writeCommand="order:create"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("footer-extra").getAttribute("data-step")).toBe("0");
    expect(screen.getByTestId("footer-extra").getAttribute("data-last")).toBe("false");

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(screen.getByTestId("footer-extra").getAttribute("data-step")).toBe("1");
    expect(screen.getByTestId("footer-extra").getAttribute("data-last")).toBe("true");
  });

  test("wizardStep is undefined on a non-wizard form", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ FooterExtra }}>
          <RenderEdit<TestValues>
            screen={makeFooterScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-1"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("footer-extra").getAttribute("data-step")).toBe("undefined");
    expect(screen.getByTestId("footer-extra").getAttribute("data-last")).toBe("undefined");
  });

  test("a declared but unregistered footer slot renders nothing and does not crash; submit stays", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{}}>
          <RenderEdit<TestValues>
            screen={makeFooterScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-1"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("footer-extra")).toBeNull();
    expect(screen.getByTestId("render-edit-submit")).toBeTruthy();
  });

  test("a declared but unregistered footer slot on a read-only screen draws no empty footer strip", () => {
    const readOnlyScreen: EntityEditScreenDefinition = {
      ...makeFooterScreen(),
      layout: {
        sections: [{ title: "Basics", columns: 1, fields: [{ field: "title", readOnly: true }] }],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{}}>
          <RenderEdit<TestValues>
            screen={readOnlyScreen}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-1"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("render-edit-submit")).toBeNull();
    expect(screen.queryByTestId("render-edit-form-actions")).toBeNull();
  });

  test("a screen without slots renders only the pre-existing actions (no extra element)", () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit-no-footer",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [{ title: "Basics", columns: 1, fields: [{ field: "title" }] }],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={screenDef}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, isUrgent: false }}
          writeCommand="order:update"
          entityId="order-1"
        />
      </DispatcherProvider>,
    );

    const actions = screen.getByTestId("render-edit-form-actions");
    expect(actions.children.length).toBe(1);
    expect(actions.children[0]?.getAttribute("data-testid")).toBe("render-edit-submit");
  });
});

// entityEdit gained layout.mode "tabs". The boot-validator used to
// reject it because a required field on a hidden tab would block submit with
// nothing on screen to explain it. What makes it safe is not per-tab scoping
// (that would skip the field instead) but the opposite: validate everything,
// then move the user to the tab holding the first error.
describe("RenderEdit tabs mode", () => {
  // Radix Tabs default to activationMode "automatic": the trigger activates on
  // focus, and a synthetic click never moves focus in happy-dom.
  function selectTab(id: string): void {
    const trigger = screen.getByTestId(`render-edit-tabs-${id}`);
    act(() => {
      trigger.focus();
      fireEvent.focus(trigger);
    });
  }

  function makeTabsScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-tabs",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "tabs",
        sections: [
          { id: "basics", title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { id: "details", title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };
  }

  describe("a section emptied by a create exclusion", () => {
    const excludedTabsScreen: EntityEditScreenDefinition = {
      id: "orders:screen:order-tabs",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "tabs",
        sections: [
          { id: "basics", title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { id: "extra", title: "Extra", columns: 1, fields: [{ field: "notes" }] },
          { id: "review", title: "Review", columns: 1, fields: [] },
        ],
      },
      writeExcludedFields: { create: ["notes"], update: ["notes"] },
    };

    function renderTabs(entityId: string | undefined) {
      render(
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <RenderEdit<TestValues>
            screen={excludedTabsScreen}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "T", notes: "stored" }}
            writeCommand="order:write"
            {...(entityId !== undefined && { entityId })}
          />
        </DispatcherProvider>,
      );
    }

    test("create renders no tab for it, but keeps a declared-empty review tab", () => {
      renderTabs(undefined);
      expect(screen.getByTestId("render-edit-tabs-basics")).toBeTruthy();
      expect(screen.queryByTestId("render-edit-tabs-extra")).toBeNull();
      expect(screen.getByTestId("render-edit-tabs-review")).toBeTruthy();
    });

    test("update keeps the tab with the excluded field read-only", () => {
      renderTabs("42");
      expect(screen.getByTestId("render-edit-tabs-extra")).toBeTruthy();
      const notesInput = screen
        .getByTestId("field-notes")
        .querySelector("input") as HTMLInputElement;
      expect(notesInput.disabled || notesInput.readOnly).toBe(true);
    });
  });

  test("renders a tab strip and keeps the inactive tab's fields mounted but hidden", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeTabsScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("render-edit-tabs")).toBeTruthy();
    expect(screen.getByTestId("render-edit-tabs-basics")).toBeTruthy();
    expect(screen.getByTestId("render-edit-tabs-details")).toBeTruthy();
    expect(screen.getByTestId("field-title").closest("[hidden]")).toBeNull();
    // Mounted (getBy, not queryBy) but inert — that is what lets one submit
    // carry a tab the user never opened.
    expect(screen.getByTestId("field-count").closest("[hidden]")).not.toBeNull();
  });

  test("a host with Tabs but no WizardStepGroup falls back to a stacked form instead of throwing", () => {
    renderWithPrimitivesOverride(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeTabsScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
      { WizardStepGroup: undefined },
    );

    expect(screen.queryByTestId("render-edit-tabs")).toBeNull();
    expect(screen.getByTestId("field-title").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("field-count").closest("[hidden]")).toBeNull();
  });

  test("the submit button shows on every tab, and there is no wizard Next", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeTabsScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("render-edit-submit")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-wizard-next")).toBeNull();
    expect(screen.queryByTestId("render-edit-wizard-step-label")).toBeNull();
  });

  test("selecting a tab swaps which section is visible", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeTabsScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    selectTab("details");

    expect(screen.getByTestId("field-count").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("field-title").closest("[hidden]")).not.toBeNull();
  });

  test("the active tab stays put when a field change hides an earlier tab", () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-tabs",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "tabs",
        sections: [
          { id: "basics", title: "Basics", columns: 1, fields: [{ field: "title" }] },
          {
            id: "details",
            title: "Details",
            columns: 1,
            fields: [{ field: "count", visible: { field: "isUrgent", eq: true } }],
          },
          { id: "extra", title: "Extra", columns: 1, fields: [{ field: "isUrgent" }] },
          { id: "tail", title: "Tail", columns: 1, fields: [{ field: "notes" }] },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={screenDef}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: true }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    selectTab("extra");
    expect(screen.getByTestId("field-isUrgent").closest("[hidden]")).toBeNull();

    const urgentSwitch = screen.getByTestId("field-isUrgent").querySelector('[role="switch"]');
    fireEvent.click(urgentSwitch as HTMLElement);

    expect(screen.queryByTestId("render-edit-tabs-details")).toBeNull();
    expect(screen.getByTestId("field-isUrgent").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("field-notes").closest("[hidden]")).not.toBeNull();
  });

  test("a root-level refine issue blocks submit visibly in a scoped form", async () => {
    const schema = z
      .object({ title: z.string(), count: z.number().optional() })
      .refine((v) => v.title !== "bad", { message: "title must not be bad" });
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "bad", count: 0, isUrgent: false }}
          writeCommand="order:create"
          schema={schema}
        />
      </DispatcherProvider>,
    );

    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    expect(screen.getAllByTestId("render-edit-root-issue").length).toBeGreaterThan(0);
  });

  test("one submit carries the values of every tab, including one never opened", async () => {
    const writes: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher((async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: { id: "1" } };
    }) as Dispatcher["write"]);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeTabsScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });
    selectTab("details");
    const countInput = screen.getByTestId("field-count").querySelector("input") as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: "7" } });
    // Submitting from "basics" — "details" is hidden at that point, and its
    // value has to travel anyway.
    selectTab("basics");

    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.payload).toMatchObject({ title: "Acme", count: 7 });
  });

  test("a server error on an unopened tab jumps there and still shows the banner for an issue without a field", async () => {
    const dispatcher = makeDispatcher((async () => ({
      isSuccess: false,
      error: {
        code: "validation_failed",
        httpStatus: 422,
        i18nKey: "kumiko.errors.validation",
        message: "Validation failed",
        details: {
          fields: [
            { path: "count", code: "too_small", i18nKey: "kumiko.errors.required" },
            { path: "version", code: "custom", i18nKey: "kumiko.errors.stale" },
          ],
        },
      },
    })) as Dispatcher["write"]);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeTabsScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("field-count").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("field-count-errors")).toBeTruthy();
    expect(screen.getByTestId("render-edit-form-error")).toBeTruthy();
  });

  test("a server error whose every issue has a rendered field jumps to that tab and shows no form-level banner", async () => {
    const dispatcher = makeDispatcher((async () => ({
      isSuccess: false,
      error: {
        code: "validation_failed",
        httpStatus: 422,
        i18nKey: "kumiko.errors.validation",
        message: "Validation failed",
        details: {
          fields: [{ path: "count", code: "unique", i18nKey: "kumiko.errors.required" }],
        },
      },
    })) as Dispatcher["write"]);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeTabsScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("field-count").closest("[hidden]")).not.toBeNull();

    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("field-count").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("field-count-errors")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
  });

  test("a required field on an unopened tab activates that tab instead of blocking in silence", async () => {
    const schema = z.object({
      title: z.string().min(1),
      count: z.number().min(1),
    });
    const writes: unknown[] = [];
    const dispatcher = makeDispatcher((async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: { id: "1" } };
    }) as Dispatcher["write"]);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeTabsScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0 }}
          writeCommand="order:create"
          schema={schema}
        />
      </DispatcherProvider>,
    );

    // Before the submit the offending field sits on a tab the user never
    // opened, so its error would have nowhere to show. This is exactly the
    // state the boot-validator used to forbid outright.
    expect(screen.getByTestId("field-count").closest("[hidden]")).not.toBeNull();

    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    expect(writes).toHaveLength(0);
    expect(screen.getByTestId("field-count").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("field-count-errors")).toBeTruthy();
    expect(screen.getByTestId("field-title").closest("[hidden]")).not.toBeNull();
  });

  // `hideSectionTitles` is only set for projectionDetail
  // (ProjectionDetailBody, kumiko-screen.tsx) — entityEdit's RenderEdit call
  // never passes it, so entityEdit tabs mode is unaffected by the per-tab
  // Card unification: every tab keeps sharing the ONE head Card the form
  // title/actions/footer already live in, with plain (non-Card) Sections per
  // tab. This test guards that entityEdit remains unaffected by the per-tab
  // Card unification, avoiding either per-tab Cards (wrong frame count) or a
  // titleless head Card (parity with the non-tabs entityEdit case above).
  test("stays on the single shared head Card across tabs — unaffected by projectionDetail's per-tab Card unification", () => {
    const { container } = render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeTabsScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    expect(container.querySelectorAll('[data-slot="card"]').length).toBe(1);
    expect(container.querySelectorAll('[data-testid^="section-"]').length).toBe(2);
  });
});

describe("RenderEdit screen form (fillScreenHeight)", () => {
  function threeSectionScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { title: "Numbers", columns: 1, fields: [{ field: "count" }] },
          { title: "Notes", columns: 1, fields: [{ field: "notes" }] },
        ],
      },
    };
  }

  function renderScreenForm(props: { entityId?: string; screenDef?: EntityEditScreenDefinition }) {
    return render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={props.screenDef ?? threeSectionScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Existing", count: 0, isUrgent: false } as TestValues}
          writeCommand={props.entityId === undefined ? "order:create" : "order:update"}
          fillScreenHeight
          {...(props.entityId !== undefined && { entityId: props.entityId })}
        />
      </DispatcherProvider>,
    );
  }

  test("edit mode: changed marker appears only after a change; footer flips from clean to counted", () => {
    renderScreenForm({ entityId: "order-1" });
    expect(document.querySelector("[data-testid$='-changed']")).toBeNull();
    const status = () => document.querySelector("[data-testid$='-unsaved']")?.textContent ?? "";
    expect(status()).toContain("No unsaved changes");
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("render-edit-discard")).toBeNull();

    const input = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Changed" } });

    expect(document.querySelector("[data-testid$='-changed']")).not.toBeNull();
    expect(status()).toContain("1 unsaved change");
    expect(screen.getByTestId("render-edit-submit").textContent).toBe("Save changes");
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  test("edit mode: Discard restores the loaded values without a server call", () => {
    renderScreenForm({ entityId: "order-1" });
    const input = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.click(screen.getByTestId("render-edit-discard"));
    expect(
      (screen.getByTestId("field-title").querySelector("input") as HTMLInputElement).value,
    ).toBe("Existing");
    expect(screen.queryByTestId("render-edit-discard")).toBeNull();
    expect(document.querySelector("[data-testid$='-unsaved']")?.textContent).toContain(
      "No unsaved changes",
    );
  });

  test("settings-list variant: section header column plus rows, accent line only on flagged fields", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={{
            id: "orders:screen:order-edit",
            type: "entityEdit",
            entity: "order",
            layout: {
              variant: "settings-list",
              sections: [
                {
                  title: "Basics",
                  description: "Core order data",
                  columns: 1,
                  fields: [{ field: "title" }, { field: "count" }],
                },
              ],
            },
          }}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Existing", count: 0, isUrgent: false } as TestValues}
          writeCommand="order:update"
          entityId="order-1"
          fillScreenHeight
          fieldAccent={(name) => name === "title"}
        />
      </DispatcherProvider>,
    );
    expect(screen.getByText("Basics")).toBeTruthy();
    expect(screen.getByText("Core order data")).toBeTruthy();
    expect(screen.getByTestId("field-title-accent")).toBeTruthy();
    expect(screen.queryByTestId("field-count-accent")).toBeNull();
  });

  test("settings-list variant without a shell header: form title moves into the section header column", () => {
    const base = threeSectionScreen();
    renderScreenForm({
      entityId: "order-1",
      screenDef: {
        ...base,
        layout: {
          variant: "settings-list",
          sections: [{ columns: 1, fields: [{ field: "title" }] }],
        },
      },
    });
    expect(document.querySelectorAll("h1, h2").length).toBe(1);
    expect(document.querySelector("section h2")?.textContent).toBe("orders:screen:order-edit");
  });

  test("create mode: no changed marker and no unsaved counter", () => {
    renderScreenForm({});
    const input = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Changed" } });
    expect(document.querySelector("[data-testid$='-changed']")).toBeNull();
    expect(document.querySelector("[data-testid$='-unsaved']")).toBeNull();
    expect(screen.queryByTestId("render-edit-discard")).toBeNull();
  });

  test("section nav appears from three titled sections", () => {
    renderScreenForm({ entityId: "order-1" });
    const nav = screen.getByTestId("form-section-nav");
    expect(nav.querySelectorAll("button").length).toBe(3);
    expect(nav.querySelector("[aria-current='true']")?.textContent).toBe("Basics");
  });

  test("section nav also lists extension sections and scrolls to them", () => {
    renderScreenForm({
      entityId: "order-1",
      screenDef: {
        id: "orders:screen:order-edit",
        type: "entityEdit",
        entity: "order",
        layout: {
          sections: [
            { title: "Basics", columns: 1, fields: [{ field: "title" }] },
            { kind: "extension", title: "History", component: { react: { __component: "X" } } },
            { kind: "extension", title: "Audit", component: { react: { __component: "Y" } } },
          ],
        },
      },
    });
    const nav = screen.getByTestId("form-section-nav");
    expect(Array.from(nav.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Basics",
      "History",
      "Audit",
    ]);
    expect(document.getElementById("form-section-1")?.textContent).toContain("History");
    expect(document.getElementById("form-section-2")?.textContent).toContain("Audit");
  });

  test("no section nav with only two sections", () => {
    const base = threeSectionScreen();
    renderScreenForm({
      entityId: "order-1",
      screenDef: { ...base, layout: { sections: base.layout.sections?.slice(0, 2) ?? [] } },
    });
    expect(screen.queryByTestId("form-section-nav")).toBeNull();
  });

  test("wizard: vertical step rail with current state and 'Weiter: <Titel>' on the next button", () => {
    renderScreenForm({
      screenDef: {
        id: "orders:screen:order-wizard",
        type: "entityEdit",
        entity: "order",
        layout: {
          mode: "wizard",
          sections: [
            { title: "Basics", columns: 1, fields: [{ field: "title" }] },
            { title: "Details", columns: 1, fields: [{ field: "count" }] },
          ],
        },
      },
    });
    expect(screen.getByTestId("render-edit-wizard-steps-step-0").getAttribute("aria-current")).toBe(
      "step",
    );
    expect(
      screen.getByTestId("render-edit-wizard-steps-step-1").getAttribute("aria-current"),
    ).toBeNull();
    expect(screen.getByTestId("render-edit-wizard-next").textContent).toContain("Details");
  });

  test("wizard: section.subtitle shows in the rail and aside.upNext announces the following step", () => {
    renderScreenForm({
      screenDef: {
        id: "orders:screen:order-wizard",
        type: "entityEdit",
        entity: "order",
        layout: {
          mode: "wizard",
          wizard: { aside: { upNext: true } },
          sections: [
            { title: "Basics", subtitle: "Name it", columns: 1, fields: [{ field: "title" }] },
            { title: "Details", subtitle: "Count it", columns: 1, fields: [{ field: "count" }] },
          ],
        },
      },
    });
    expect(screen.getByTestId("render-edit-wizard-steps-subtitle-0").textContent).toBe("Name it");
    const upNext = screen.getByTestId("render-edit-wizard-steps-up-next");
    expect(upNext.textContent).toContain("Details");
    expect(upNext.textContent).toContain("Count it");
  });

  test("wizard: no up-next box on the last step or without aside", () => {
    renderScreenForm({
      screenDef: {
        id: "orders:screen:order-wizard",
        type: "entityEdit",
        entity: "order",
        layout: {
          mode: "wizard",
          sections: [
            { title: "Basics", columns: 1, fields: [{ field: "title" }] },
            { title: "Details", columns: 1, fields: [{ field: "count" }] },
          ],
        },
      },
    });
    expect(screen.queryByTestId("render-edit-wizard-steps-up-next")).toBeNull();
  });

  test("titleTemplate follows the typed values and falls back to the plain title while empty", () => {
    const bundles = { en: { "orders.title.add": "Add {title}" } };
    render(
      <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[bundles]}>
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <RenderEdit<TestValues>
            screen={{
              ...threeSectionScreen(),
              titleTemplate: "orders.title.add",
            }}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "" } as TestValues}
            writeCommand="order:create"
            fillScreenHeight
          />
        </DispatcherProvider>
      </LocaleProvider>,
    );
    const heading = () => screen.getByTestId("render-edit-form-title").textContent;
    expect(heading()).not.toContain("Add");

    const input = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Golf" } });
    expect(heading()).toBe("Add Golf");
  });
});
