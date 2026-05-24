import { describe, expect, test, mock } from "bun:test";
import { z } from "zod";
import type { Dispatcher, WriteResult } from "../../dispatcher";
import { createStore } from "../../store";
import { createFormController } from "../form-controller";

// Fake dispatcher scoped to this test file — same shape as contract.test.ts
// but with an explicit spy on write() so assertions can inspect argv.
function makeDispatcher(response?: WriteResult): Dispatcher & {
  readonly writeSpy: ReturnType<typeof mock>;
} {
  const writeSpy = mock(
    async () => response ?? ({ isSuccess: true, data: { id: "srv-1" } } as WriteResult),
  );
  return {
    writeSpy,
    write: writeSpy as unknown as Dispatcher["write"],
    async query<TData>() {
      return { isSuccess: true, data: null } as unknown as { isSuccess: true; data: TData };
    },
    async batch() {
      return { isSuccess: true, results: [] };
    },
    statusStore: createStore("online"),
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

describe("createFormController — submit()", () => {
  test("throws when called without a submit-config — no guessing the destination", async () => {
    const form = createFormController({ initial: { title: "hello" } });

    await expect(form.submit()).rejects.toThrow(/submit\(\) called without a `submit` config/);
  });

  test("happy path: dispatches values, returns success, rebases form", async () => {
    const disp = makeDispatcher();
    const form = createFormController({
      initial: { title: "hello" },
      submit: { dispatcher: disp, type: "app:write:task:create" },
    });
    form.setField("title", "world");

    const result = await form.submit();

    expect(disp.writeSpy).toHaveBeenCalledWith("app:write:task:create", { title: "world" });
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess && !("validationBlocked" in result && result.validationBlocked)) {
      expect(result.data).toEqual({ id: "srv-1" });
    }
    // Post-submit the form should be at its new clean baseline.
    const snap = form.getSnapshot();
    expect(snap.isDirty).toBe(false);
    expect(snap.initial.title).toBe("world");
    expect(snap.changes).toEqual({});
  });

  test("local validation failure short-circuits — no network call", async () => {
    const disp = makeDispatcher();
    const form = createFormController({
      initial: { title: "" },
      schema: z.object({ title: z.string().min(3) }),
      submit: { dispatcher: disp, type: "app:write:task:create" },
    });

    const result = await form.submit();

    expect(disp.writeSpy).not.toHaveBeenCalled();
    expect(result.validationBlocked).toBe(true);
    expect(result.isSuccess).toBe(false);
    expect(form.getSnapshot().errors["title"]).toBeDefined();
  });

  test("server validation failure: field errors land on the form", async () => {
    const disp = makeDispatcher({
      isSuccess: false,
      error: {
        code: "validation_error",
        httpStatus: 400,
        i18nKey: "errors.validation.failed",
        message: "Validation failed",
        details: {
          fields: [{ path: "title", code: "too_small", i18nKey: "errors.validation.too_small" }],
        },
      },
    });
    const form = createFormController({
      initial: { title: "hello" }, // passes local validate()
      submit: { dispatcher: disp, type: "app:write:task:create" },
    });

    const result = await form.submit();

    expect(result.isSuccess).toBe(false);
    expect(result.validationBlocked).toBe(false);
    // Errors pushed onto the form — renderer shows them identically to
    // local-validate failures.
    expect(form.getSnapshot().errors["title"]).toBeDefined();
    expect(form.getSnapshot().errors["title"]?.[0]?.code).toBe("too_small");
  });

  test("non-validation server error: form state is left alone, error passes through", async () => {
    const disp = makeDispatcher({
      isSuccess: false,
      error: {
        code: "rate_limited",
        httpStatus: 429,
        i18nKey: "errors.rateLimited",
        message: "Too many requests",
      },
    });
    const form = createFormController({
      initial: { title: "hello" },
      submit: { dispatcher: disp, type: "app:write:task:create" },
    });

    const result = await form.submit();

    expect(result.isSuccess).toBe(false);
    expect(form.getSnapshot().errors).toEqual({}); // untouched
    if (!result.isSuccess && !("validationBlocked" in result && result.validationBlocked)) {
      expect(result.error.code).toBe("rate_limited");
    }
  });

  test("payloadMode: 'changes' — sends only the delta, skips dispatch when clean", async () => {
    const disp = makeDispatcher();
    const form = createFormController({
      initial: { title: "hello", count: 3 },
      submit: {
        dispatcher: disp,
        type: "app:write:task:update",
        payloadMode: "changes",
      },
    });

    // Clean form → no network call, success with current values.
    const cleanResult = await form.submit();
    expect(disp.writeSpy).not.toHaveBeenCalled();
    expect(cleanResult.isSuccess).toBe(true);

    // Touch one field, submit — only that field goes out.
    form.setField("title", "world");
    await form.submit();
    expect(disp.writeSpy).toHaveBeenCalledWith("app:write:task:update", { title: "world" });
  });

  test("stale-submit race: edits during the in-flight write stay dirty after success", async () => {
    // User submits "hello", the network takes 50ms. During those 50ms the
    // user types "world" into the same field. The server sees "hello"
    // (correct — we snapshotted before the await). On success, baseline
    // becomes "hello" (what was submitted), NOT "world" (what's currently
    // displayed). The user still sees their in-flight edit AND it still
    // counts as dirty — so they can submit it again.
    let resolve: ((result: WriteResult) => void) | undefined;
    const slowResponse = new Promise<WriteResult>((r) => {
      resolve = r;
    });
    const disp: Dispatcher = {
      write: (async () => slowResponse) as unknown as Dispatcher["write"],
      async query<TData>() {
        return { isSuccess: true, data: null } as unknown as { isSuccess: true; data: TData };
      },
      async batch() {
        return { isSuccess: true as const, results: [] };
      },
      statusStore: createStore("online"),
      pendingWrites: () => [],
      pendingFiles: () => [],
    };

    const form = createFormController({
      initial: { title: "" },
      submit: { dispatcher: disp, type: "app:write:task:create" },
    });
    form.setField("title", "hello");

    const submitPromise = form.submit();

    // User types during the in-flight call.
    form.setField("title", "world");

    resolve?.({ isSuccess: true, data: { id: "s1" } });
    await submitPromise;

    const snap = form.getSnapshot();
    expect(snap.values.title).toBe("world"); // user's in-flight edit preserved
    expect(snap.initial.title).toBe("hello"); // baseline = what was submitted
    expect(snap.isDirty).toBe(true); // "world" is a new unsaved change
    expect(snap.changes).toEqual({ title: "world" });
  });

  test("concurrent submit(): two parallel calls produce ONE write, both see the same result", async () => {
    // Double-click scenario: the form fires submit() twice in quick
    // succession, before the first write returned. The guard serializes
    // them — only one network call, both promises resolve to the same
    // result.
    const disp = makeDispatcher({ isSuccess: true, data: { id: "only-one" } });
    const form = createFormController({
      initial: { title: "hello" },
      submit: { dispatcher: disp, type: "app:write:task:create" },
    });

    const [r1, r2] = await Promise.all([form.submit(), form.submit()]);

    expect(disp.writeSpy).toHaveBeenCalledTimes(1);
    // Both callers get the same success envelope.
    expect(r1.isSuccess).toBe(true);
    expect(r2.isSuccess).toBe(true);
  });

  test("buildPayload: composes parent + child controllers into nested payload", async () => {
    // Typical sub-controller pattern for hasMany-lines: parent form +
    // N separate line-controllers. buildPayload assembles the nested
    // payload the server's nested-write expects.
    const disp = makeDispatcher();

    const parent = createFormController({
      initial: { title: "Order #1" },
    });
    const line1 = createFormController({
      initial: { product: "Widget", qty: 2 },
    });
    const line2 = createFormController({
      initial: { product: "Gadget", qty: 5 },
    });

    // Parent drives submit; buildPayload pulls lines from the
    // externally-held controllers. The server's nested-write expander
    // does the rest.
    const formWithSubmit = createFormController({
      initial: parent.getSnapshot().values,
      submit: {
        dispatcher: disp,
        type: "orders:write:order:create",
        buildPayload: (snap) => ({
          ...snap.values,
          lines: [line1.getSnapshot().values, line2.getSnapshot().values],
        }),
      },
    });

    await formWithSubmit.submit();

    expect(disp.writeSpy).toHaveBeenCalledWith("orders:write:order:create", {
      title: "Order #1",
      lines: [
        { product: "Widget", qty: 2 },
        { product: "Gadget", qty: 5 },
      ],
    });
  });

  test("buildPayload is called once at submit-start, not re-called during in-flight", async () => {
    // Stale-safety check for buildPayload: the user may keep editing
    // during the await. The payload is captured BEFORE the network
    // call, so late edits don't leak into what the server receives.
    let resolve: ((result: WriteResult) => void) | undefined;
    const slow = new Promise<WriteResult>((r) => {
      resolve = r;
    });
    const disp: Dispatcher = {
      write: mock(async () => slow) as unknown as Dispatcher["write"],
      async query<TData>() {
        return { isSuccess: true, data: null } as unknown as { isSuccess: true; data: TData };
      },
      async batch() {
        return { isSuccess: true as const, results: [] };
      },
      statusStore: createStore("online"),
      pendingWrites: () => [],
      pendingFiles: () => [],
    };

    let buildCalls = 0;
    const form = createFormController({
      initial: { title: "a" },
      submit: {
        dispatcher: disp,
        type: "app:write:x:create",
        buildPayload: (snap) => {
          buildCalls++;
          return { title: snap.values.title };
        },
      },
    });

    const submitPromise = form.submit();
    // User types during the await — this MUST NOT re-trigger buildPayload.
    form.setField("title", "mutated");
    resolve?.({ isSuccess: true, data: { id: "s1" } });
    await submitPromise;

    expect(buildCalls).toBe(1);
  });

  test("submit with schema + payloadMode='values' validates BEFORE dispatch", async () => {
    // Order matters: if validate() runs after dispatch, a bad payload
    // hits the network and the caller can't tell user-error from
    // server-error. The form's contract is "validate first, network
    // only if clean".
    const disp = makeDispatcher();
    const form = createFormController({
      initial: { title: "" },
      schema: z.object({ title: z.string().min(1) }),
      submit: { dispatcher: disp, type: "app:write:task:create" },
    });

    const result = await form.submit();

    expect(result.validationBlocked).toBe(true);
    expect(disp.writeSpy).not.toHaveBeenCalled();
  });
});
