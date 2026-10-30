import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { AuthCard, AuthShellProvider } from "../auth-form-primitives.tsx";
import { LoginScreen } from "../login-screen.tsx";
import { renderWithProviders } from "./test-utils.tsx";

function Shell({ card }: { readonly card: ReactNode }): ReactNode {
  return <div data-testid="apex-chrome">{card}</div>;
}

describe("AuthCard / AuthShell", () => {
  test("without a provider → default fullscreen wrapper (backward-compatible)", () => {
    const { container } = renderWithProviders(
      <AuthCard title="Login">
        <div data-testid="body">body</div>
      </AuthCard>,
    );
    expect(container.querySelector(".min-h-screen")).not.toBeNull();
    expect(container.querySelector(".max-w-sm")).not.toBeNull();
    expect(container.querySelector("[data-testid=body]")).not.toBeNull();
  });

  test("with a provider → App shell replaces fullscreen wrapper, card remains", () => {
    const { container } = renderWithProviders(
      <AuthShellProvider shell={(card) => <Shell card={card} />}>
        <AuthCard title="Login">
          <div data-testid="body">body</div>
        </AuthCard>
      </AuthShellProvider>,
    );
    expect(container.querySelector("[data-testid=apex-chrome]")).not.toBeNull();
    expect(container.querySelector(".min-h-screen")).toBeNull();
    // The card (max-w-sm) and its content remain; the shell only wraps them.
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
