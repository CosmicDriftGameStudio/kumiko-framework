import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { AuthCard, AuthShellProvider } from "../auth-form-primitives";
import { renderWithProviders } from "./test-utils";

describe("AuthCard / AuthShell", () => {
  test("ohne Provider → Default-Fullscreen-Wrapper (rückwärtskompatibel)", () => {
    const { container } = renderWithProviders(
      <AuthCard title="Login">
        <div data-testid="body">body</div>
      </AuthCard>,
    );
    expect(container.querySelector(".min-h-screen")).not.toBeNull();
    expect(container.querySelector(".max-w-sm")).not.toBeNull();
    expect(container.querySelector("[data-testid=body]")).not.toBeNull();
  });

  test("mit Provider → App-Shell ersetzt Fullscreen-Wrapper, Card bleibt", () => {
    function Shell({ card }: { readonly card: ReactNode }): ReactNode {
      return <div data-testid="apex-chrome">{card}</div>;
    }
    const { container } = renderWithProviders(
      <AuthShellProvider shell={(card) => <Shell card={card} />}>
        <AuthCard title="Login">
          <div data-testid="body">body</div>
        </AuthCard>
      </AuthShellProvider>,
    );
    expect(container.querySelector("[data-testid=apex-chrome]")).not.toBeNull();
    expect(container.querySelector(".min-h-screen")).toBeNull();
    // Card-Box (max-w-sm) + Inhalt bleiben — Shell wrappt nur, ersetzt nicht.
    expect(container.querySelector(".max-w-sm")).not.toBeNull();
    expect(container.querySelector("[data-testid=body]")).not.toBeNull();
  });
});
