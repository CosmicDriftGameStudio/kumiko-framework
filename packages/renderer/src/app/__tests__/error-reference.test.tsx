import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { DispatcherError } from "../../headless/index.ts";
import { render } from "../../web/__tests__/test-utils.tsx";
import { ErrorReference, errorNoticeOf } from "../error-reference.tsx";
import { QueryErrorBanner } from "../query-state-banners.tsx";
import { WriteFailedError } from "../write-failed-error.ts";

afterEach(cleanup);

function stubClipboard(): { readonly written: string[]; restore: () => void } {
  const written: string[] = [];
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void written.push(text) },
  });
  return {
    written,
    restore: () => {
      if (original) Object.defineProperty(navigator, "clipboard", original);
    },
  };
}

const serverError: DispatcherError = {
  code: "boom",
  httpStatus: 500,
  i18nKey: "errors.boom",
  message: "Server exploded",
  requestId: "7f9c2a1e-0000-4000-8000-123456789abc",
};

describe("ErrorReference", () => {
  test("shows the full request id and copies it", async () => {
    const clipboard = stubClipboard();
    try {
      render(<ErrorReference requestId={serverError.requestId} />);
      expect(screen.getByTestId("error-reference-id").textContent).toBe(
        `Error ID: ${serverError.requestId}`,
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId("error-reference-copy"));
      });
      expect(clipboard.written).toEqual([serverError.requestId as string]);
    } finally {
      clipboard.restore();
    }
  });

  test("renders nothing without a request id", () => {
    const { container } = render(<ErrorReference requestId={undefined} />);
    expect(screen.queryByTestId("error-reference-id")).toBeNull();
    expect(container.textContent).toBe("");
  });
});

describe("errorNoticeOf", () => {
  test("carries the request id of a WriteFailedError", () => {
    expect(errorNoticeOf(new WriteFailedError(serverError, "Server exploded"))).toEqual({
      message: "Server exploded",
      requestId: serverError.requestId as string,
    });
  });

  test("plain errors and non-errors have no request id", () => {
    expect(errorNoticeOf(new Error("plain"))).toEqual({ message: "plain" });
    expect(errorNoticeOf("text")).toEqual({ message: "text" });
  });
});

describe("QueryErrorBanner", () => {
  test("shows the request id of the failed query", () => {
    render(
      <QueryErrorBanner error={serverError} translate={(key) => key} onRetry={() => undefined} />,
    );
    expect(screen.getByTestId("kumiko-screen-error").textContent).toContain(
      `Error ID: ${serverError.requestId}`,
    );
  });

  test("keeps the layout unchanged without a request id", () => {
    const { requestId: _omitted, ...withoutId } = serverError;
    render(
      <QueryErrorBanner error={withoutId} translate={(key) => key} onRetry={() => undefined} />,
    );
    expect(screen.queryByTestId("error-reference-id")).toBeNull();
  });
});
