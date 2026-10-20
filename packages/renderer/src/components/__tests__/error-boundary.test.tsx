import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { ErrorBoundary } from "../error-boundary.tsx";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let errorSpy: ReturnType<typeof spyOn<Console, "error">>;
beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
});

function Thrower({ message }: { readonly message: string }): ReactNode {
  throw new Error(message);
}

describe("ErrorBoundary errorId", () => {
  test("hands the same uuid to onError and the fallback", () => {
    const seen: string[] = [];
    render(
      <ErrorBoundary
        scope="test"
        onError={(_error, _info, context) => seen.push(context.errorId)}
        fallback={({ errorId }) => <span data-testid="id">{errorId}</span>}
      >
        <Thrower message="boom" />
      </ErrorBoundary>,
    );
    const shown = screen.getByTestId("id").textContent ?? "";
    expect(shown).toMatch(UUID);
    expect(seen).toEqual([shown]);
  });

  test("every new error after a reset gets a fresh id", () => {
    const ids: string[] = [];
    function Host(): ReactNode {
      const [message, setMessage] = useState("first");
      return (
        <ErrorBoundary
          scope="test"
          onError={(_e, _i, context) => ids.push(context.errorId)}
          fallback={({ reset }) => (
            <button
              type="button"
              data-testid="retry"
              onClick={() => {
                setMessage("second");
                reset();
              }}
            >
              retry
            </button>
          )}
        >
          <Thrower message={message} />
        </ErrorBoundary>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByTestId("retry"));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
