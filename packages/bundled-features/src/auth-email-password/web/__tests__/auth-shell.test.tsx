import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { AuthCard, AuthShellProvider } from "../auth-form-primitives.js";
import { LoginScreen } from "../login-screen.js";
import { renderWithProviders } from "./test-utils.js";

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

  test("className, headerClassName, titleClassName, bodyClassName land on their elements", () => {
    const { container } = renderWithProviders(
      <AuthCard
        title="Login"
        className="card-x"
        headerClassName="header-x"
        titleClassName="title-x"
        bodyClassName="body-x"
      >
        <div data-testid="body">body</div>
      </AuthCard>,
    );
    const card = container.querySelector(".card-x");
    expect(card?.className).toContain("max-w-sm");
    expect(container.querySelector(".header-x")?.querySelector("h1.title-x")).not.toBeNull();
    const body = container.querySelector(".body-x");
    expect(body?.contains(container.querySelector("[data-testid=body]"))).toBe(true);
    expect(card?.contains(body ?? null)).toBe(true);
  });

  test("bodyClassName is tailwind-merged over the default padding", () => {
    const { container } = renderWithProviders(
      <AuthCard title="Login" bodyClassName="pt-2 pb-4">
        <div data-testid="body">body</div>
      </AuthCard>,
    );
    const body = container.querySelector("[data-testid=body]")?.parentElement;
    expect(body?.className).toBe("p-6 flex flex-col gap-4 pt-2 pb-4");
  });

  test("LoginScreen renders the default body wrapper exactly once", () => {
    const { container } = renderWithProviders(<LoginScreen />);
    expect(container.querySelectorAll(".p-6.pt-0.flex.flex-col.gap-4").length).toBe(1);
  });
});
