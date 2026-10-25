import { describe, expect, mock, spyOn, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { sleep } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { PATCH_DRAFT_SAVE_DEBOUNCE_MS } from "../../components/use-wizard-form-draft.ts";
import type { Dispatcher, SubmitResult } from "../../headless/index.ts";
import {
  DispatcherProvider,
  DraftStorageProvider,
  RenderEdit,
  type RenderEditControls,
} from "../../index.ts";
import { makeDispatcher, orderEntity, type TestValues } from "./_render-edit-helpers.tsx";
import {
  act,
  createFakeDraftStorage,
  createMockDispatcher,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "./test-utils.tsx";

describe("RenderEdit wizard draft", () => {
  function makeDraftWizardScreen(draft: boolean): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-wizard-draft",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        ...(draft && { draft: true }),
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };
  }

  type DraftBlob = { readonly values: Record<string, unknown>; readonly stepIndex: number };

  function isDraftSavePayload(payload: unknown): payload is DraftBlob {
    return (
      typeof payload === "object" &&
      payload !== null &&
      "values" in payload &&
      "stepIndex" in payload
    );
  }

  // In-memory fake of the bundled form-draft feature's query/write handlers —
  // proves RenderEdit round-trips through the dispatcher (real values, real
  // step), not just that it calls the right command names.
  function makeDraftDispatcher(): {
    readonly dispatcher: Dispatcher;
    readonly store: { current: DraftBlob | null };
    readonly calls: string[];
  } {
    const store: { current: DraftBlob | null } = { current: null };
    const calls: string[] = [];
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        calls.push(type);
        if (type === "form-draft:query:get") {
          return { isSuccess: true, data: { draft: store.current } };
        }
        return { isSuccess: true, data: {} };
      }) as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        calls.push(type);
        if (type === "form-draft:write:save" && isDraftSavePayload(payload)) {
          store.current = { values: payload.values, stepIndex: payload.stepIndex };
        } else if (type === "form-draft:write:discard") {
          store.current = null;
        }
        return { isSuccess: true, data: { id: "1" } };
      }) as Dispatcher["write"],
    });
    return { dispatcher, store, calls };
  }

  test("values and step survive a remount", async () => {
    const { dispatcher } = makeDraftDispatcher();
    // Simulates the browser: the same DraftStorage instance (sessionStorage
    // in production) survives the remount below, RenderEdit's in-memory
    // React state does not. Without it there's no draftId to resume from
    // and the mount would fall back to `form-draft:query:list` instead —
    // this test is specifically about the storage-resume path.
    const draftStorage = createFakeDraftStorage();

    const first = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={draftStorage}>
          <RenderEdit<TestValues>
            screen={makeDraftWizardScreen(true)}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    first.unmount();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={draftStorage}>
          <RenderEdit<TestValues>
            screen={makeDraftWizardScreen(true)}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("field-count")).toBeTruthy());
    expect(screen.getByTestId("field-title").closest("[hidden]")).not.toBeNull();
    expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("2");

    fireEvent.click(screen.getByTestId("render-edit-wizard-back"));
    const titleInputAgain = screen
      .getByTestId("field-title")
      .querySelector("input") as HTMLInputElement;
    expect(titleInputAgain.value).toBe("Acme");
  });

  // security: a `format: "password"` field must never reach the
  // persisted draft blob — it would be stored in the clear server-side and
  // restored in plaintext on resume.
  test("a password-format field is stripped from the draft save payload", async () => {
    const passwordEntity = {
      fields: {
        title: { type: "text", required: true },
        apiToken: { type: "text", format: "password" },
        count: { type: "number" },
      },
    } as unknown as EntityDefinition;

    const passwordScreen: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard-draft-password",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        draft: true,
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }, { field: "apiToken" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };

    const savedPayloads: DraftBlob[] = [];
    const dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: {} })) as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        if (type === "form-draft:write:save" && isDraftSavePayload(payload)) {
          savedPayloads.push(payload);
        }
        return { isSuccess: true, data: { id: "1" } };
      }) as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues & { apiToken?: string }>
            screen={passwordScreen}
            entity={passwordEntity}
            featureName="orders"
            initial={{ title: "", count: 0, apiToken: "" }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    fireEvent.change(screen.getByTestId("field-title").querySelector("input") as HTMLInputElement, {
      target: { value: "Acme" },
    });
    fireEvent.change(
      screen.getByTestId("field-apiToken").querySelector("input") as HTMLInputElement,
      { target: { value: "hunter2" } },
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });

    expect(savedPayloads.length).toBeGreaterThan(0);
    const saved = savedPayloads[0] as DraftBlob;
    expect(saved.values["title"]).toBe("Acme");
    expect(Object.keys(saved.values)).not.toContain("apiToken");
    expect(JSON.stringify(saved.values)).not.toContain("hunter2");
  });

  // A writeOnly field must never reach the persisted draft blob either — the
  // typed secret would be stored in the clear server-side.
  test("a writeOnly field is stripped from the draft save payload", async () => {
    const writeOnlyEntity = {
      fields: {
        title: { type: "text", required: true },
        apiToken: { type: "text", writeOnly: true },
        count: { type: "number" },
      },
    } as unknown as EntityDefinition;

    const writeOnlyScreen: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard-draft-write-only",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        draft: true,
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }, { field: "apiToken" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };

    const savedPayloads: DraftBlob[] = [];
    const dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: {} })) as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        if (type === "form-draft:write:save" && isDraftSavePayload(payload)) {
          savedPayloads.push(payload);
        }
        return { isSuccess: true, data: { id: "1" } };
      }) as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues & { apiToken?: string }>
            screen={writeOnlyScreen}
            entity={writeOnlyEntity}
            featureName="orders"
            initial={{ title: "", count: 0, apiToken: "" }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    fireEvent.change(screen.getByTestId("field-title").querySelector("input") as HTMLInputElement, {
      target: { value: "Acme" },
    });
    fireEvent.change(
      screen.getByTestId("field-apiToken").querySelector("input") as HTMLInputElement,
      { target: { value: "hunter2" } },
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });

    expect(savedPayloads.length).toBeGreaterThan(0);
    const saved = savedPayloads[0] as DraftBlob;
    expect(saved.values["title"]).toBe("Acme");
    expect(Object.keys(saved.values)).not.toContain("apiToken");
    expect(JSON.stringify(saved.values)).not.toContain("hunter2");
  });

  test("a sensitive field is stripped from the draft save payload", async () => {
    const sensitiveEntity = {
      fields: {
        title: { type: "text", required: true },
        iban: { type: "text", sensitive: true },
        count: { type: "number" },
      },
    } as unknown as EntityDefinition;

    const sensitiveScreen: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard-draft-sensitive",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        draft: true,
        sections: [
          { title: "Basics", columns: 1, fields: [{ field: "title" }, { field: "iban" }] },
          { title: "Details", columns: 1, fields: [{ field: "count" }] },
        ],
      },
    };

    const savedPayloads: DraftBlob[] = [];
    const dispatcher = createMockDispatcher({
      query: (async () => ({ isSuccess: true, data: {} })) as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        if (type === "form-draft:write:save" && isDraftSavePayload(payload)) {
          savedPayloads.push(payload);
        }
        return { isSuccess: true, data: { id: "1" } };
      }) as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues & { iban?: string }>
            screen={sensitiveScreen}
            entity={sensitiveEntity}
            featureName="orders"
            initial={{ title: "", count: 0, iban: "" }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    fireEvent.change(screen.getByTestId("field-title").querySelector("input") as HTMLInputElement, {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByTestId("field-iban").querySelector("input") as HTMLInputElement, {
      target: { value: "DE89370400440532013000" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });

    expect(savedPayloads.length).toBeGreaterThan(0);
    const saved = savedPayloads[0] as DraftBlob;
    expect(saved.values["title"]).toBe("Acme");
    expect(Object.keys(saved.values)).not.toContain("iban");
    expect(JSON.stringify(saved.values)).not.toContain("DE89370400440532013000");
  });

  // Bare crypto.randomUUID() breaks in non-secure contexts and
  // React Native/Hermes without a polyfill. With it deleted, minting a
  // draftId must still work through the mintDraftId() fallback instead of
  // throwing.
  test("draft id still mints when crypto.randomUUID is unavailable", async () => {
    const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    const original = cryptoRef?.randomUUID;
    // `randomUUID` lives on crypto's prototype (non-configurable) — `delete`
    // is a silent no-op there, so shadow it with an own `undefined` instead.
    if (cryptoRef) cryptoRef.randomUUID = undefined;

    try {
      const draftKeys: string[] = [];
      const dispatcher = createMockDispatcher({
        query: (async () => ({ isSuccess: true, data: {} })) as Dispatcher["query"],
        write: (async (type: string, payload: unknown) => {
          if (type === "form-draft:write:save") {
            draftKeys.push((payload as { draftKey: string }).draftKey);
          }
          return { isSuccess: true, data: { id: "1" } };
        }) as Dispatcher["write"],
      });

      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <DraftStorageProvider value={createFakeDraftStorage()}>
            <RenderEdit<TestValues>
              screen={makeDraftWizardScreen(true)}
              entity={orderEntity}
              featureName="orders"
              initial={{ title: "", count: 0 }}
              writeCommand="order:create"
            />
          </DraftStorageProvider>
        </DispatcherProvider>,
      );

      fireEvent.change(
        screen.getByTestId("field-title").querySelector("input") as HTMLInputElement,
        { target: { value: "Acme" } },
      );
      await act(async () => {
        fireEvent.submit(screen.getByTestId("render-edit-form"));
        await Promise.resolve();
      });

      expect(draftKeys.length).toBeGreaterThan(0);
      expect(draftKeys[0]).toContain(":new:draft-");
    } finally {
      if (cryptoRef && original) cryptoRef.randomUUID = original;
    }
  });

  test("a successful submit discards the draft", async () => {
    const { dispatcher, store, calls } = makeDraftDispatcher();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(true)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(store.current).not.toBeNull();

    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(store.current).toBeNull();
    expect(calls).toContain("form-draft:write:discard");
  });

  // payloadMode "changes" + an untouched form means
  // controller.submit() never calls dispatcher.write (nothing changed to
  // send) — handleSubmit must not treat that no-write success like a normal
  // submit and discard the draft underneath it, or a host driving
  // controls.submit() on a pre-filled, untouched form silently loses it.
  test("payloadMode 'changes' + an unchanged form: submit() is a no-op that keeps the draft alive", async () => {
    const { dispatcher, store, calls } = makeDraftDispatcher();
    let controls: RenderEditControls<TestValues> | undefined;
    let submitResult: SubmitResult<unknown> | undefined;

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(true)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0 }}
          writeCommand="order:create"
          payloadMode="changes"
          onControlsReady={(c) => {
            controls = c;
          }}
          onSubmit={(result) => {
            submitResult = result;
          }}
        />
      </DispatcherProvider>,
    );

    // Step to the last wizard step without touching any field — saveDraft()
    // persists the current (unmodified) values, so a draft exists, but the
    // form itself is still not dirty.
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });
    await waitFor(() => expect(store.current).not.toBeNull());
    calls.length = 0;

    // The built-in Save button stays disabled on an unchanged form — drive
    // the write the way a host would (RenderEditControls.submit(), the API
    // this changeset's "pre-filled, untouched form" use case documents).
    await act(async () => {
      await controls?.submit();
    });

    expect(submitResult?.validationBlocked).toBe(false);
    if (submitResult?.validationBlocked === false) {
      expect(submitResult.isSuccess).toBe(true);
      expect(submitResult.isNoOp).toBe(true);
    }
    expect(calls).not.toContain("order:create");
    expect(calls).not.toContain("form-draft:write:discard");
    expect(store.current).not.toBeNull();
  });

  test("without layout.draft nothing hits the form-draft feature", async () => {
    const { dispatcher, calls } = makeDraftDispatcher();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(false)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });

    const form = screen.getByTestId("render-edit-form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(calls.some((c) => c.startsWith("form-draft:"))).toBe(false);
  });

  // The restore effect's `if (controller.getSnapshot().isDirty) return;`
  // guard (render-edit.tsx) — a user who starts typing before the
  // form-draft:query:get round-trip resolves must not have their input
  // clobbered by the stored draft landing afterwards.
  test("typing while the restore query is in flight — the typed value wins over the stored draft", async () => {
    let resolveRestore: (result: {
      readonly isSuccess: true;
      readonly data: { readonly draft: DraftBlob | null };
    }) => void = () => {};
    const restorePromise = new Promise<{
      readonly isSuccess: true;
      readonly data: { readonly draft: DraftBlob | null };
    }>((resolve) => {
      resolveRestore = resolve;
    });
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "form-draft:query:get") return restorePromise;
        return { isSuccess: true, data: {} };
      }) as Dispatcher["query"],
      write: (async () => ({ isSuccess: true, data: { id: "1" } })) as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(true)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          entityId="order-1"
          writeCommand="order:update"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Typed while loading" } });

    resolveRestore({
      isSuccess: true,
      data: { draft: { values: { title: "From storage", count: 9 }, stepIndex: 1 } },
    });
    // The step advancing to 2 only happens once setValues/setRawStep from
    // the restore effect actually ran — waiting for it proves the restore
    // fully landed before asserting the title was left untouched.
    await waitFor(() =>
      expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("2"),
    );

    expect(titleInput.value).toBe("Typed while loading");
  });

  // patch() (controlled mode / extension sections) previously
  // never triggered a draft save — only handleWizardNext/Back did. A patch()
  // on the last step (no further Next click coming) or on a step abandoned
  // without Next/Back was silently lost, forcing e.g. a repeat of a paid
  // VIN-decode round-trip on resume.
  test("controls.patch() on the last step persists into the draft blob (debounced)", async () => {
    const { dispatcher, store } = makeDraftDispatcher();
    let controls: RenderEditControls<TestValues> | undefined;

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(true)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    // Reach the last step first (handleWizardNext's own saveDraft mints the
    // draftId) — the bug is specifically about a patch() AFTER that, with no
    // further Next/Back to piggyback a save on.
    fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
    expect(screen.getByTestId("field-count")).toBeTruthy();

    act(() => {
      controls?.patch({ count: 7 });
    });

    await waitFor(
      () => {
        const values = store.current?.values as { count?: number } | undefined;
        expect(values?.count).toBe(7);
      },
      { timeout: 3000 },
    );
  });

  test("remount after patch() without a Next/Back click shows the patched value", async () => {
    const { dispatcher, store } = makeDraftDispatcher();
    const draftStorage = createFakeDraftStorage();
    let controls: RenderEditControls<TestValues> | undefined;

    const first = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={draftStorage}>
          <RenderEdit<TestValues>
            screen={makeDraftWizardScreen(true)}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
            onControlsReady={(c) => {
              controls = c;
            }}
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    // No Next/Back click anywhere in this test — patch() alone, on the
    // first step, must still mint a draftId and persist (proves there is
    // no second, blob-bypassing write path for patch()'d data either: this
    // writes exclusively via patch(), the remount below reads exclusively
    // via form-draft:query:get).
    act(() => {
      controls?.patch({ title: "Patched" });
    });

    await waitFor(() => expect(store.current).not.toBeNull(), { timeout: 3000 });

    first.unmount();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={draftStorage}>
          <RenderEdit<TestValues>
            screen={makeDraftWizardScreen(true)}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(
      () => {
        const titleInput = screen
          .getByTestId("field-title")
          .querySelector("input") as HTMLInputElement;
        expect(titleInput.value).toBe("Patched");
      },
      { timeout: 3000 },
    );
  });

  test("a draftKey over the server's 256-char limit is not sent — warns and skips instead of failing silently server-side", async () => {
    const { dispatcher, calls } = makeDraftDispatcher();
    let controls: RenderEditControls<TestValues> | undefined;
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <RenderEdit<TestValues>
            screen={{ ...makeDraftWizardScreen(true), id: `orders:screen:${"x".repeat(300)}` }}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
            onControlsReady={(c) => {
              controls = c;
            }}
          />
        </DispatcherProvider>,
      );

      act(() => {
        controls?.patch({ count: 1 });
      });

      await waitFor(() => expect(warnSpy).toHaveBeenCalled(), { timeout: 3000 });
      expect(calls.filter((c) => c === "form-draft:write:save").length).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("a burst of patch() calls collapses into a single debounced draft save", async () => {
    const { dispatcher, calls } = makeDraftDispatcher();
    let controls: RenderEditControls<TestValues> | undefined;

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(true)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0 }}
          writeCommand="order:create"
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    const savesSoFar = () => calls.filter((c) => c === "form-draft:write:save").length;
    const before = savesSoFar();

    // Each patch() resets the same debounce timer — three patches in one
    // burst must still land as exactly one form-draft:write:save, not three.
    act(() => {
      controls?.patch({ count: 1 });
      controls?.patch({ count: 2 });
      controls?.patch({ count: 3 });
    });

    await waitFor(() => expect(savesSoFar()).toBe(before + 1), { timeout: 3000 });
    expect(savesSoFar()).toBe(before + 1);

    // The debounce collapses bursts into one save, but a save landing in a
    // LATER window (the burst's tail re-arming the timer, or an unrelated
    // second burst) would slip past an assertion taken right after the
    // first save. Wait out a full extra debounce window to prove there is
    // no straggler.
    await sleep(PATCH_DRAFT_SAVE_DEBOUNCE_MS + 1000);
    expect(savesSoFar()).toBe(before + 1);
  });

  // A patch() inside the 500ms debounce window followed by an
  // unmount (navigation away, dialog close) must not drop the save — the
  // old cleanup only cleared the timer, silently discarding the last edit.
  test("a pending debounced patch-save flushes on unmount instead of being dropped", async () => {
    const { dispatcher, store } = makeDraftDispatcher();
    let controls: RenderEditControls<TestValues> | undefined;

    const rendered = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(true)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0 }}
          writeCommand="order:create"
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
    expect(screen.getByTestId("field-count")).toBeTruthy();

    // Arms the debounce, then unmounts well inside the 500ms window — before
    // the timer could ever fire on its own.
    act(() => {
      controls?.patch({ count: 7 });
    });
    rendered.unmount();

    await waitFor(() => expect(store.current?.values["count"]).toBe(7));
  });

  // The debounce must not resurrect a draft after it was intentionally
  // ended: discardDraft() clears the pending timer (render-edit.tsx:735-738)
  // specifically so a patch() immediately followed by submit can't have its
  // debounced save land AFTER the discard and leave an orphaned row behind.
  test("a pending debounced patch-save is killed by submit's discard, not resurrected later", async () => {
    const { dispatcher, store, calls } = makeDraftDispatcher();
    let controls: RenderEditControls<TestValues> | undefined;

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeDraftWizardScreen(true)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0 }}
          writeCommand="order:create"
          onControlsReady={(c) => {
            controls = c;
          }}
        />
      </DispatcherProvider>,
    );

    fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
    expect(screen.getByTestId("field-count")).toBeTruthy();

    // patch() arms a 500ms debounced draft save, then submit fires well
    // inside that window — before the timer could ever run on its own.
    act(() => {
      controls?.patch({ count: 9 });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-submit"));
      await Promise.resolve();
    });

    expect(calls).toContain("form-draft:write:discard");
    const savesAtSubmit = calls.filter((c) => c === "form-draft:write:save").length;
    expect(store.current).toBeNull();

    // Wait past the debounce window the patch() call armed. If discard
    // hadn't cleared the timer, a straggling save would land here and
    // resurrect the just-discarded draft.
    await sleep(PATCH_DRAFT_SAVE_DEBOUNCE_MS + 1000);

    expect(calls.filter((c) => c === "form-draft:write:save").length).toBe(savesAtSubmit);
    expect(store.current).toBeNull();
  });

  // A rejected discard write (network error) must be best-effort: the entity
  // write already succeeded by the time discardDraft() runs, so a failure
  // here must not propagate out of handleSubmit and break onSubmit/
  // navigation — that would risk a duplicate submit on retry. Orphaned draft
  // rows are swept later by cleanup.job.ts.
  test("a rejected discard write does not break an otherwise successful submit", async () => {
    const seenResults: SubmitResult<unknown>[] = [];
    const write = mock(async (type: string) => {
      if (type === "form-draft:write:discard") throw new Error("network error");
      return { isSuccess: true, data: { id: "1" } };
    });
    const dispatcher = makeDispatcher(write as unknown as Dispatcher["write"]);

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={makeDraftWizardScreen(true)}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
            onSubmit={(r) => seenResults.push(r)}
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });

    const countInput = screen.getByTestId("field-count").querySelector("input") as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: "5" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-submit"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // handleSubmit completed despite the rejected discard: onSubmit still
    // fired with the successful entity-write result, not an unhandled
    // rejection or an aborted handler.
    expect(seenResults).toHaveLength(1);
    expect(seenResults[0]?.isSuccess).toBe(true);
  });

  // `disabled` means "no input/no write", not "no navigation". The
  // old `if (disabled) return` guard sat BEFORE the wizard-next branch, and
  // Next itself carried `disabled={disabled}` — together they made a
  // disabled wizard unnavigable past step 0. Next must still step forward,
  // but without running validate() (would block on an empty required field
  // nobody can fill in) or saveDraft() (would mint a draftId / dispatch a
  // write — exactly what `disabled` forbids).
  test("disabled: clicking Next on step 0 navigates without validating or writing a draft", async () => {
    const schema = z.object({ title: z.string().min(1), count: z.number().optional() });
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);

    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={makeDraftWizardScreen(true)}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
            schema={schema}
            disabled
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("field-title")).toBeTruthy();
    fireEvent.click(screen.getByTestId("render-edit-wizard-next"));

    // Navigated despite the empty required `title` field.
    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(screen.getByTestId("field-title").closest("[hidden]")).not.toBeNull();
    // No validate() ran (no field error painted) and no write fired
    // (neither a form-draft:write:save nor an order:create).
    expect(write).not.toHaveBeenCalled();
  });
});

describe("RenderEdit create-mode draftId", () => {
  function makeDraftWizardScreen(): EntityEditScreenDefinition {
    return {
      id: "orders:screen:order-wizard-draftid",
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
  }

  type DraftBlob = { readonly values: Record<string, unknown>; readonly stepIndex: number };
  type StoredDraft = DraftBlob & { readonly savedAt: string };

  // Per-draftKey fake (unlike the single-slot `makeDraftDispatcher` above) —
  // needed to prove two parallel create sessions land on two distinct rows,
  // and to back the `form-draft:query:list` fallback (multiple candidates,
  // picker, adopt).
  function makeMultiDraftDispatcher(): {
    readonly dispatcher: Dispatcher;
    readonly drafts: Map<string, StoredDraft>;
  } {
    const drafts = new Map<string, StoredDraft>();
    let seq = 0;
    const dispatcher = createMockDispatcher({
      query: (async (type: string, payload: unknown) => {
        if (type === "form-draft:query:get") {
          const { draftKey } = payload as { draftKey: string };
          return { isSuccess: true, data: { draft: drafts.get(draftKey) ?? null } };
        }
        if (type === "form-draft:query:list") {
          const { screenId } = payload as { screenId: string };
          const prefix = `${screenId}:`;
          const matches = [...drafts.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, draft]) => ({
              id: key,
              draftKey: key,
              stepIndex: draft.stepIndex,
              savedAt: draft.savedAt,
            }));
          return { isSuccess: true, data: { drafts: matches } };
        }
        return { isSuccess: true, data: {} };
      }) as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        if (type === "form-draft:write:save") {
          const { draftKey, values, stepIndex } = payload as {
            draftKey: string;
            values: Record<string, unknown>;
            stepIndex: number;
          };
          seq += 1;
          drafts.set(draftKey, {
            values,
            stepIndex,
            savedAt: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
          });
        } else if (type === "form-draft:write:discard") {
          const { draftKey } = payload as { draftKey: string };
          drafts.delete(draftKey);
        }
        return { isSuccess: true, data: { id: "1" } };
      }) as Dispatcher["write"],
    });
    return { dispatcher, drafts };
  }

  test("two parallel create sessions on the same screen get different draftKeys and don't overwrite each other", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();

    const sessionA = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );
    const sessionB = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    const titleA = within(sessionA.container)
      .getByTestId("field-title")
      .querySelector("input") as HTMLInputElement;
    fireEvent.change(titleA, { target: { value: "Session A" } });
    await act(async () => {
      fireEvent.submit(within(sessionA.container).getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    const titleB = within(sessionB.container)
      .getByTestId("field-title")
      .querySelector("input") as HTMLInputElement;
    fireEvent.change(titleB, { target: { value: "Session B" } });
    await act(async () => {
      fireEvent.submit(within(sessionB.container).getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    const prefix = `${screenDef.id}:new:`;
    const createDraftKeys = [...drafts.keys()].filter((k) => k.startsWith(prefix));
    expect(createDraftKeys).toHaveLength(2);
    const [keyA, keyB] = createDraftKeys as [string, string];
    expect(keyA).not.toBe(keyB);
    const titles = createDraftKeys.map((k) => drafts.get(k)?.values["title"]).sort();
    expect(titles).toEqual(["Session A", "Session B"]);
  });

  // Same-tab variant of the test above: two RenderEdit instances sharing
  // ONE DraftStorage AND one dispatcher — the layout a single browser tab
  // with two open create forms actually has (a fresh DraftStorage per
  // session only happens across tabs). The mint keys off each component's
  // own `draftId` React state, not a re-read of the shared storage slot, so
  // this must isolate too.
  test("two parallel create sessions sharing one DraftStorage still get different draftKeys", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    const sharedDraftStorage = createFakeDraftStorage();

    const sessionA = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={sharedDraftStorage}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );
    const sessionB = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={sharedDraftStorage}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    const titleA = within(sessionA.container)
      .getByTestId("field-title")
      .querySelector("input") as HTMLInputElement;
    fireEvent.change(titleA, { target: { value: "Session A" } });
    await act(async () => {
      fireEvent.submit(within(sessionA.container).getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    const titleB = within(sessionB.container)
      .getByTestId("field-title")
      .querySelector("input") as HTMLInputElement;
    fireEvent.change(titleB, { target: { value: "Session B" } });
    await act(async () => {
      fireEvent.submit(within(sessionB.container).getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    const prefix = `${screenDef.id}:new:`;
    const createDraftKeys = [...drafts.keys()].filter((k) => k.startsWith(prefix));
    expect(createDraftKeys).toHaveLength(2);
    const [keyA, keyB] = createDraftKeys as [string, string];
    expect(keyA).not.toBe(keyB);
    const titles = createDraftKeys.map((k) => drafts.get(k)?.values["title"]).sort();
    expect(titles).toEqual(["Session A", "Session B"]);
  });

  test("cleared storage with exactly one open draft still shows the picker — no silent cross-tab adopt", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    // Pre-seed one existing create-mode draft, as if minted by an earlier,
    // now-storage-less session (new tab / cleared sessionStorage) — or a
    // genuinely different parallel session on the same screen. Auto-adopting
    // it would silently hand this tab someone else's in-progress draft.
    drafts.set(`${screenDef.id}:new:existing-id`, {
      values: { title: "Resumed", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-01T00:00:00Z",
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
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-draft-picker")).toBeTruthy());
    // No silent adopt: the form stays pristine until the user picks.
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput.value).toBe("");
    // single-candidate is now the normal case (auto-adopt removed) —
    // the banner text and the "start new" button must both resolve to real
    // copy, not the raw i18n keys.
    const picker = screen.getByTestId("render-edit-draft-picker");
    expect(picker.textContent).toContain("Found an open draft for this form");
    expect(picker.textContent).not.toContain("kumiko.form.draft.resume-single");
    expect(screen.getByTestId("render-edit-draft-start-new").textContent).toBe("Start new");
  });

  test("start-new on a one-candidate picker clears it without adopting, leaving the candidate untouched", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    drafts.set(`${screenDef.id}:new:existing-id`, {
      values: { title: "Resumed", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-01T00:00:00Z",
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
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-draft-picker")).toBeTruthy());
    fireEvent.click(screen.getByTestId("render-edit-draft-start-new"));
    expect(screen.queryByTestId("render-edit-draft-picker")).toBeNull();

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Brand new" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });

    // Minted a genuinely different draftId — the ignored candidate is untouched.
    expect(drafts.get(`${screenDef.id}:new:existing-id`)?.values["title"]).toBe("Resumed");
    const prefix = `${screenDef.id}:new:`;
    const mintedKeys = [...drafts.keys()].filter(
      (k) => k.startsWith(prefix) && k !== `${prefix}existing-id`,
    );
    expect(mintedKeys).toHaveLength(1);
    expect(drafts.get(mintedKeys[0] as string)?.values["title"]).toBe("Brand new");
  });

  test("cleared storage with multiple open drafts shows a picker; picking one resumes it", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    drafts.set(`${screenDef.id}:new:draft-1`, {
      values: { title: "First draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-01T00:00:00Z",
    });
    drafts.set(`${screenDef.id}:new:draft-2`, {
      values: { title: "Second draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-02T00:00:00Z",
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
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-draft-picker")).toBeTruthy());
    // Multiple candidates keep the plural banner copy.
    expect(screen.getByTestId("render-edit-draft-picker").textContent).toContain(
      "Found multiple open drafts",
    );
    const pickSecond = screen.getByTestId(`render-edit-draft-pick-${screenDef.id}:new:draft-2`);
    fireEvent.click(pickSecond);

    await waitFor(() => {
      const titleInput = screen
        .getByTestId("field-title")
        .querySelector("input") as HTMLInputElement;
      expect(titleInput.value).toBe("Second draft");
    });
    expect(screen.queryByTestId("render-edit-draft-picker")).toBeNull();
  });

  test("minting a draftId clears a stale picker — a candidate can't hijack the just-minted key", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    drafts.set(`${screenDef.id}:new:draft-1`, {
      values: { title: "First draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-01T00:00:00Z",
    });
    drafts.set(`${screenDef.id}:new:draft-2`, {
      values: { title: "Second draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-02T00:00:00Z",
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
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("render-edit-draft-picker")).toBeTruthy());

    // The user ignores the picker and starts a genuinely new record instead.
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Fresh session" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });

    // The stale picker must not survive the mint — picking draft-1/draft-2
    // afterwards would repoint draftKey at an unrelated draft mid-edit.
    expect(screen.queryByTestId("render-edit-draft-picker")).toBeNull();

    const prefix = `${screenDef.id}:new:`;
    const mintedKeys = [...drafts.keys()].filter(
      (k) => k.startsWith(prefix) && k !== `${prefix}draft-1` && k !== `${prefix}draft-2`,
    );
    expect(mintedKeys).toHaveLength(1);
    const [mintedKey] = mintedKeys as [string];
    expect(drafts.get(mintedKey)?.values["title"]).toBe("Fresh session");
    // The two pre-existing candidates are untouched by the fresh mint.
    expect(drafts.get(`${prefix}draft-1`)?.values["title"]).toBe("First draft");
    expect(drafts.get(`${prefix}draft-2`)?.values["title"]).toBe("Second draft");
  });

  test("discarding a draft doesn't re-arm the list fallback and silently adopt a parallel draft", async () => {
    const { dispatcher: baseDispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    // A parallel create session on the same screen, still open.
    drafts.set(`${screenDef.id}:new:other-session`, {
      values: { title: "Someone else's draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-01T00:00:00Z",
    });

    // Counts `form-draft:query:list` calls directly — the mechanism under
    // test (didListRef) gates exactly this call, so this is a more precise
    // signal than any DOM side effect of a (possibly delayed) re-adopt.
    let listCallCount = 0;
    const dispatcher: Dispatcher = {
      ...baseDispatcher,
      query: (async (type: string, payload: unknown) => {
        if (type === "form-draft:query:list") listCallCount += 1;
        return (baseDispatcher.query as (t: string, p: unknown) => Promise<unknown>)(type, payload);
      }) as Dispatcher["query"],
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            writeCommand="order:create"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    // The lone open draft (`other-session`) shows in the picker on mount —
    // the user explicitly picks it (no silent cross-tab auto-adopt).
    await waitFor(() => expect(screen.getByTestId("render-edit-draft-picker")).toBeTruthy());
    fireEvent.click(screen.getByTestId(`render-edit-draft-pick-${screenDef.id}:new:other-session`));
    await waitFor(() => {
      const titleInput = screen
        .getByTestId("field-title")
        .querySelector("input") as HTMLInputElement;
      expect(titleInput.value).toBe("Someone else's draft");
    });
    expect(listCallCount).toBe(1);

    // The user overwrites the adopted draft with their own new record,
    // steps through the wizard, and submits on the last step — a real
    // submit (not just a draft-save Next), which discards the (now
    // theirs) draftId.
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "My own record" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      await Promise.resolve();
    });
    const countInput = screen.getByTestId("field-count").querySelector("input") as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: "5" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-submit"));
      await Promise.resolve();
    });

    expect(drafts.has(`${screenDef.id}:new:other-session`)).toBe(false);

    // A second parallel draft appears on the same screen right after submit
    // (e.g. another tab). The just-discarded instance's draftId reset to
    // null must not re-run the list fallback and silently repopulate the
    // form with it — a re-arm would auto-adopt it, jump the wizard back to
    // its saved step (0) and overwrite the just-submitted values, which
    // would put step 0's "field-title" section back on screen.
    drafts.set(`${screenDef.id}:new:yet-another-session`, {
      values: { title: "A completely different draft", count: 0 },
      stepIndex: 0,
      savedAt: "2026-01-03T00:00:00Z",
    });
    // Flush thoroughly (not just one microtask tick) — a re-armed effect's
    // full chain (query → filter → setDraftId → re-render → GET restore →
    // setValues) needs several turns to complete, and this assertion must
    // hold even after every one of them ran.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(listCallCount).toBe(1);
    expect(screen.getByTestId("field-title").closest("[hidden]")).not.toBeNull();
    expect(screen.queryByTestId("render-edit-draft-picker")).toBeNull();
    const countAfterSubmit = screen
      .getByTestId("field-count")
      .querySelector("input") as HTMLInputElement;
    expect(countAfterSubmit.value).toBe("5");
  });

  test("edit-mode draftKey stays screenId:entityId — unaffected by create-mode draftId minting", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Existing", count: 5 }}
            entityId="order-77"
            writeCommand="order:update"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Existing edited" } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    expect([...drafts.keys()]).toEqual([`${screenDef.id}:order-77`]);
  });

  // draftKey is `${screen.id}:${entityId}` — opening a different entity on
  // the same screen must not resume the previous entity's saved draft.
  test("switching entityId does not load the previous entity's draft", async () => {
    const { dispatcher, drafts } = makeMultiDraftDispatcher();
    const screenDef = makeDraftWizardScreen();
    drafts.set(`${screenDef.id}:order-A`, {
      values: { title: "Draft for A", count: 1 },
      stepIndex: 0,
      savedAt: "2026-01-01T00:00:00Z",
    });

    const first = render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            entityId="order-A"
            writeCommand="order:update"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    await waitFor(() =>
      expect(
        (screen.getByTestId("field-title").querySelector("input") as HTMLInputElement).value,
      ).toBe("Draft for A"),
    );
    first.unmount();

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DraftStorageProvider value={createFakeDraftStorage()}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0 }}
            entityId="order-B"
            writeCommand="order:update"
          />
        </DraftStorageProvider>
      </DispatcherProvider>,
    );

    const titleInputB = screen
      .getByTestId("field-title")
      .querySelector("input") as HTMLInputElement;
    expect(titleInputB.value).toBe("");
  });
});
