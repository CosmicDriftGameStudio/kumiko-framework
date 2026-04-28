// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { Avatar } from "../layout/avatar";
import { render, screen } from "./test-utils";

describe("Avatar", () => {
  test("Initials aus 'Daniel Hennig' → 'DH'", () => {
    render(<Avatar id="user-1" label="Daniel Hennig" />);
    expect(screen.getByRole("img", { name: "Daniel Hennig" }).textContent).toBe("DH");
  });

  test("Initials aus single-name 'Daniel' → 'DA' (erste 2 Buchstaben)", () => {
    render(<Avatar id="user-2" label="Daniel" />);
    expect(screen.getByRole("img", { name: "Daniel" }).textContent).toBe("DA");
  });

  test("Initials aus email 'alice@example.com' → 'AL' (erste 2 Buchstaben)", () => {
    render(<Avatar id="user-3" label="alice@example.com" />);
    expect(screen.getByRole("img", { name: "alice@example.com" }).textContent).toBe("AL");
  });

  test("empty label → '?'-Fallback", () => {
    render(<Avatar id="user-4" label="" />);
    expect(screen.getByRole("img", { name: "" }).textContent).toBe("?");
  });

  test("gleiche id → gleiche Color-Klasse (deterministic)", () => {
    const { rerender, container } = render(<Avatar id="stable-id" label="A B" />);
    const colorBefore = container.querySelector("[role='img']")?.className;
    rerender(<Avatar id="stable-id" label="C D" />);
    const colorAfter = container.querySelector("[role='img']")?.className;
    expect(colorBefore).toBe(colorAfter);
  });
});
