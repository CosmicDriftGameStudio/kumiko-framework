import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CapUsage } from "../../types.ts";
import { CapUsageBar } from "../cap-usage-bar.tsx";

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

function fillClass(): string | undefined {
  return screen.getByTestId("cap-usage-bar").firstElementChild?.className;
}

describe("CapUsageBar", () => {
  test("renders the not-measured text instead of a bar when used is null", () => {
    const usage: CapUsage = { used: null, limit: 100, fraction: 0 };
    render(
      <Wrapper>
        <CapUsageBar usage={usage} showLabel={false} />
      </Wrapper>,
    );

    expect(screen.queryByTestId("cap-usage-bar")).toBeNull();
    expect(screen.getByTestId("cap-usage-not-measured").textContent).toBe(
      "cap-overview.notMeasured",
    );
  });

  test("renders the danger fill class when usage is at or over the limit", () => {
    const usage: CapUsage = { used: 120, limit: 100, fraction: 1.2 };
    render(
      <Wrapper>
        <CapUsageBar usage={usage} showLabel={false} />
      </Wrapper>,
    );

    expect(fillClass()).toContain("bg-status-critical");
    expect(fillClass()).not.toContain("bg-primary");
  });

  test("renders the default fill class when usage is well under the limit", () => {
    const usage: CapUsage = { used: 4, limit: 100, fraction: 0.04 };
    render(
      <Wrapper>
        <CapUsageBar usage={usage} showLabel={false} />
      </Wrapper>,
    );

    expect(fillClass()).toContain("bg-primary");
    expect(fillClass()).not.toContain("bg-status-critical");
  });

  test("renders the warn fill class when usage is in the warn zone", () => {
    const usage: CapUsage = { used: 85, limit: 100, fraction: 0.85 };
    render(
      <Wrapper>
        <CapUsageBar usage={usage} showLabel={false} />
      </Wrapper>,
    );

    expect(fillClass()).toContain("bg-status-warn");
    expect(fillClass()).not.toContain("bg-primary");
    expect(fillClass()).not.toContain("bg-status-critical");
  });

  test("renders the raw used count instead of a bar when limit is null (unlimited)", () => {
    const usage: CapUsage = { used: 165, limit: null, fraction: 0 };
    render(
      <Wrapper>
        <CapUsageBar usage={usage} />
      </Wrapper>,
    );

    expect(screen.queryByTestId("cap-usage-bar")).toBeNull();
    expect(screen.getByTestId("cap-usage-unlimited").textContent).toBe("cap-overview.unlimited");
  });

  test("renders nothing for an unlimited cap when showLabel is false", () => {
    const usage: CapUsage = { used: 165, limit: null, fraction: 0 };
    render(
      <Wrapper>
        <CapUsageBar usage={usage} showLabel={false} />
      </Wrapper>,
    );

    expect(screen.queryByTestId("cap-usage-bar")).toBeNull();
    expect(screen.queryByTestId("cap-usage-unlimited")).toBeNull();
  });

  test("not-measured wins over unlimited when both used and limit are null", () => {
    const usage: CapUsage = { used: null, limit: null, fraction: 0 };
    render(
      <Wrapper>
        <CapUsageBar usage={usage} />
      </Wrapper>,
    );

    expect(screen.getByTestId("cap-usage-not-measured")).toBeTruthy();
    expect(screen.queryByTestId("cap-usage-unlimited")).toBeNull();
  });

  test("limit 0 renders not-included, even when nothing is measured", () => {
    for (const used of [null, 5]) {
      const usage: CapUsage = { used, limit: 0, fraction: 0 };
      const { unmount } = render(
        <Wrapper>
          <CapUsageBar usage={usage} />
        </Wrapper>,
      );

      expect(screen.getByTestId("cap-usage-not-included").textContent).toBe(
        "cap-overview.notIncluded",
      );
      expect(screen.queryByTestId("cap-usage-bar")).toBeNull();
      expect(screen.queryByTestId("cap-usage-not-measured")).toBeNull();
      unmount();
    }
  });

  test("formats used and limit by unit and groups plain numbers", () => {
    const { unmount } = render(
      <Wrapper>
        <CapUsageBar usage={{ used: 1536, limit: 102400, fraction: 0.015, unit: "mb" }} />
      </Wrapper>,
    );
    expect(screen.getByText(/1\.5.GB \/ 100.GB/)).toBeTruthy();
    unmount();

    render(
      <Wrapper>
        <CapUsageBar usage={{ used: 1500, limit: 150000, fraction: 0.01, unit: "count" }} />
      </Wrapper>,
    );
    expect(screen.getByText(/1,500 \/ 150,000/)).toBeTruthy();
  });
});
