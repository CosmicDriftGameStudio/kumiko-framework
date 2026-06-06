// Avatar Render-Tests (Phase 1, test-luecken-integration, Tier 2).
//
// Avatar ist ein pures Presentational-Component (kein Context, kein Radix)
// → happy-dom-Render reicht. Pinnt die Initials-Extraktion und die
// deterministische, id-basierte Farbwahl.

import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Avatar } from "../avatar";

const colorClass = (className: string): string | undefined =>
  className.split(/\s+/).find((c) => c.startsWith("bg-"));

describe("Avatar — Initials", () => {
  test("Zwei-Wort-Label → Initialen beider Wörter (DH), role=img, aria-label", () => {
    render(<Avatar id="u1" label="Daniel Hennig" testId="av" />);
    const el = screen.getByTestId("av");
    expect(el.textContent).toBe("DH");
    expect(el.getAttribute("role")).toBe("img");
    expect(el.getAttribute("aria-label")).toBe("Daniel Hennig");
  });

  test("Single-Word → erste 2 Buchstaben, upper-case (Daniel → DA)", () => {
    render(<Avatar id="u" label="Daniel" testId="av" />);
    expect(screen.getByTestId("av").textContent).toBe("DA");
  });

  test("Email als Single-Token → erste 2 Buchstaben (alice@… → AL)", () => {
    // Hinweis: der Code-Kommentar behauptet "A", der Code liefert aber "AL"
    // (split(/\s+/) trennt nicht an '@'). Test pinnt das IST-Verhalten.
    render(<Avatar id="u" label="alice@example.com" testId="av" />);
    expect(screen.getByTestId("av").textContent).toBe("AL");
  });

  test("leeres / reines Whitespace-Label → '?'", () => {
    render(<Avatar id="u" label="   " testId="av" />);
    expect(screen.getByTestId("av").textContent).toBe("?");
  });
});

describe("Avatar — Farbwahl", () => {
  test("deterministisch pro id (gleiche id → gleiche Color-Class, unabhängig vom Label)", () => {
    const { unmount } = render(<Avatar id="stable-id" label="A B" testId="a1" />);
    const c1 = colorClass(screen.getByTestId("a1").className);
    unmount();
    render(<Avatar id="stable-id" label="Z W" testId="a2" />);
    const c2 = colorClass(screen.getByTestId("a2").className);
    expect(c1).toMatch(/^bg-/);
    expect(c1).toBe(c2);
  });
});
