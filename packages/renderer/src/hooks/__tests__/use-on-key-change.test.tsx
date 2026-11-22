import { describe, expect, mock, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useOnKeyChange } from "../use-on-key-change.ts";

type HookProps = {
  readonly keyValue: string | null;
  readonly run: (key: string) => void;
  readonly initial?: "run" | "skip";
};

function renderOnKeyChange(initialProps: HookProps) {
  return renderHook(
    ({ keyValue, run, initial }: HookProps) =>
      useOnKeyChange(keyValue, run, initial === undefined ? undefined : { initial }),
    { initialProps },
  );
}

describe("useOnKeyChange", () => {
  test("runs for the first key", () => {
    const run = mock((_key: string) => {});
    renderOnKeyChange({ keyValue: "a", run });
    expect(run.mock.calls).toEqual([["a"]]);
  });

  test("with initial skip the first key is only remembered, a later change runs", () => {
    const run = mock((_key: string) => {});
    const { rerender } = renderOnKeyChange({ keyValue: "a", run, initial: "skip" });
    expect(run).not.toHaveBeenCalled();
    rerender({ keyValue: "a", run, initial: "skip" });
    expect(run).not.toHaveBeenCalled();
    rerender({ keyValue: "b", run, initial: "skip" });
    expect(run.mock.calls).toEqual([["b"]]);
  });

  test("null does nothing and forgets nothing (A -> null -> A runs once)", () => {
    const run = mock((_key: string) => {});
    const { rerender } = renderOnKeyChange({ keyValue: null, run });
    expect(run).not.toHaveBeenCalled();
    rerender({ keyValue: "a", run });
    rerender({ keyValue: null, run });
    rerender({ keyValue: "a", run });
    expect(run.mock.calls).toEqual([["a"]]);
  });

  test("a change A -> B runs exactly once", () => {
    const run = mock((_key: string) => {});
    const { rerender } = renderOnKeyChange({ keyValue: "a", run });
    rerender({ keyValue: "b", run });
    rerender({ keyValue: "b", run });
    expect(run.mock.calls).toEqual([["a"], ["b"]]);
  });

  test("a new run identity for the same key does not run again", () => {
    const first = mock((_key: string) => {});
    const second = mock((_key: string) => {});
    const { rerender } = renderOnKeyChange({ keyValue: "a", run: first });
    rerender({ keyValue: "a", run: second });
    expect(first.mock.calls).toEqual([["a"]]);
    expect(second).not.toHaveBeenCalled();
  });

  test("object keys are rejected at compile time, an inline object would run on every render", () => {
    const run = mock((_key: unknown) => {});
    const { rerender } = renderHook(() =>
      // @ts-expect-error an inline object key is a new identity on every render
      useOnKeyChange({ id: "a" }, run),
    );
    rerender();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
