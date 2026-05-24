import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeAuthGate } from "../auth-gate";
import { makeSessionApi, renderWithProviders } from "./test-utils";

describe("makeAuthGate", () => {
  function CustomLogin(): ReactNode {
    return <div data-testid="custom-login">custom-login</div>;
  }

  test("loading → renders placeholder, not children, not login", () => {
    const Gate = makeAuthGate(CustomLogin);
    const session = makeSessionApi({ status: "loading", user: null });
    const { container } = renderWithProviders(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
      { session },
    );
    expect(screen.queryByTestId("protected")).toBeNull();
    expect(screen.queryByTestId("custom-login")).toBeNull();
    // Placeholder div ist gerendert (kein leerer Tree)
    expect(container.firstChild).not.toBeNull();
  });

  test("unauthenticated → renders LoginComponent, not children", () => {
    const Gate = makeAuthGate(CustomLogin);
    const session = makeSessionApi({ status: "unauthenticated", user: null });
    renderWithProviders(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
      { session },
    );
    expect(screen.getByTestId("custom-login")).toBeTruthy();
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  test("authenticated → renders children, not login", () => {
    const Gate = makeAuthGate(CustomLogin);
    renderWithProviders(
      <Gate>
        <div data-testid="protected">secret</div>
      </Gate>,
    );
    expect(screen.getByTestId("protected")).toBeTruthy();
    expect(screen.queryByTestId("custom-login")).toBeNull();
  });
});
