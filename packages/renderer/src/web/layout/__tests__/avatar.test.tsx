// Avatar rendering tests.
//
// Avatar is a pure presentational component without context or Radix,
// so happy-dom rendering is sufficient. These tests pin initial extraction
// and deterministic, ID-based color selection.

import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Avatar } from "../avatar.tsx";

const colorClass = (className: string): string | undefined =>
  className.split(/\s+/).find((c) => c.startsWith("bg-"));

describe("Avatar — Initials", () => {
  test("Two-word label → initials of both words (DH), role=img, aria-label", () => {
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

  test("Email as a single token → first 2 letters (alice@… → AL)", () => {
    // The code comment claims "A", but the code returns "AL".
    // (split(/\s+/) does not split at '@'.) This test pins the current behavior.
    render(<Avatar id="u" label="alice@example.com" testId="av" />);
    expect(screen.getByTestId("av").textContent).toBe("AL");
  });

  test("leeres / reines Whitespace-Label → '?'", () => {
    render(<Avatar id="u" label="   " testId="av" />);
    expect(screen.getByTestId("av").textContent).toBe("?");
  });
});

describe("Avatar — Farbwahl", () => {
  test("Deterministic per id (same id → same Color-Class, regardless of label)", () => {
    const { unmount } = render(<Avatar id="stable-id" label="A B" testId="a1" />);
    const c1 = colorClass(screen.getByTestId("a1").className);
    unmount();
    render(<Avatar id="stable-id" label="Z W" testId="a2" />);
    const c2 = colorClass(screen.getByTestId("a2").className);
    expect(c1).toMatch(/^bg-/);
    expect(c1).toBe(c2);
  });
});
