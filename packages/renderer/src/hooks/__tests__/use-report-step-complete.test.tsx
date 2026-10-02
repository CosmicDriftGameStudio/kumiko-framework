import { describe, expect, mock, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useReportStepComplete } from "../use-report-step-complete.js";

type HookProps = {
  readonly report: ((complete: boolean) => void) | undefined;
  readonly complete: boolean | null;
};

function renderReport(initialProps: HookProps) {
  return renderHook(({ report, complete }: HookProps) => useReportStepComplete(report, complete), {
    initialProps,
  });
}

describe("useReportStepComplete", () => {
  test("reports nothing while the step's data is still loading", () => {
    const report = mock((_complete: boolean) => {});
    renderReport({ report, complete: null });
    expect(report).not.toHaveBeenCalled();
  });

  test("reports the value once loaded and again only when it changes", () => {
    const report = mock((_complete: boolean) => {});
    const { rerender } = renderReport({ report, complete: null });
    rerender({ report, complete: false });
    rerender({ report, complete: false });
    rerender({ report, complete: true });
    expect(report.mock.calls).toEqual([[false], [true]]);
  });

  test("does nothing outside an update-mode wizard (no reporter passed)", () => {
    expect(() => renderReport({ report: undefined, complete: true })).not.toThrow();
  });
});
