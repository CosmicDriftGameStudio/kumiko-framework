import { describe, expect, mock, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { DispatcherProvider, useForm } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { z } from "zod";
import { act, createMockDispatcher, renderHook } from "./test-utils";

type Values = { title: string; count?: number };

function makeDispatcher(writeFn?: Dispatcher["write"]): Dispatcher {
  return createMockDispatcher({ write: writeFn });
}

function wrap(dispatcher: Dispatcher) {
  return ({ children }: { children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
  );
}

describe("useForm", () => {
  test("snapshot reflects setField mutations", () => {
    const dispatcher = makeDispatcher();
    const { result } = renderHook(
      () =>
        useForm<Values>({
          initial: { title: "", count: 0 },
          submit: { type: "x:create" },
        }),
      { wrapper: wrap(dispatcher) },
    );

    expect(result.current.snapshot.values.title).toBe("");
    expect(result.current.snapshot.isDirty).toBe(false);

    act(() => result.current.controller.setField("title", "hello"));
    expect(result.current.snapshot.values.title).toBe("hello");
    expect(result.current.snapshot.isDirty).toBe(true);
    expect(result.current.snapshot.changes.title).toBe("hello");
  });

  test("submit dispatches to the context dispatcher when no explicit one is passed", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "123" } }) as never);
    const dispatcher = makeDispatcher(write);
    const { result } = renderHook(
      () =>
        useForm<Values>({
          initial: { title: "", count: 0 },
          submit: { type: "x:create" },
        }),
      { wrapper: wrap(dispatcher) },
    );

    act(() => result.current.controller.setField("title", "new"));
    let submitResult: unknown;
    await act(async () => {
      submitResult = await result.current.controller.submit();
    });

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith("x:create", expect.anything());
    expect((submitResult as { isSuccess: boolean }).isSuccess).toBe(true);
  });

  test("zod schema failure blocks submit; no network call fires", async () => {
    const write = mock();
    const dispatcher = makeDispatcher(write as unknown as Dispatcher["write"]);
    const schema = z.object({ title: z.string().min(1), count: z.number().optional() });
    const { result } = renderHook(
      () =>
        useForm<Values>({
          initial: { title: "", count: 0 },
          schema,
          submit: { type: "x:create" },
        }),
      { wrapper: wrap(dispatcher) },
    );

    let submitResult: unknown;
    await act(async () => {
      submitResult = await result.current.controller.submit();
    });

    expect(write).not.toHaveBeenCalled();
    expect((submitResult as { validationBlocked: boolean }).validationBlocked).toBe(true);
    expect(Object.keys(result.current.snapshot.errors)).toContain("title");
  });

  test("explicit dispatcher on submit wins over context dispatcher", async () => {
    const contextWrite = mock(async () => ({ isSuccess: true, data: {} }) as never);
    const overrideWrite = mock(async () => ({ isSuccess: true, data: {} }) as never);
    const contextDispatcher = makeDispatcher(contextWrite);
    const overrideDispatcher = makeDispatcher(overrideWrite);

    const { result } = renderHook(
      () =>
        useForm<Values>({
          initial: { title: "hi", count: 0 },
          submit: { type: "x:create", dispatcher: overrideDispatcher },
        }),
      { wrapper: wrap(contextDispatcher) },
    );

    act(() => result.current.controller.setField("title", "changed"));
    await act(async () => {
      await result.current.controller.submit();
    });

    expect(overrideWrite).toHaveBeenCalled();
    expect(contextWrite).not.toHaveBeenCalled();
  });
});
