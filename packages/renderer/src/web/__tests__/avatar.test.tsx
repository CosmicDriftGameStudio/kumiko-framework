import { describe, expect, test } from "bun:test";
import { Avatar } from "../layout/avatar.tsx";
import { render, screen } from "./test-utils.tsx";

describe("Avatar", () => {
  test("Initials from 'Daniel Hennig' → 'DH'", () => {
    render(<Avatar id="user-1" label="Daniel Hennig" />);
    expect(screen.getByRole("img", { name: "Daniel Hennig" }).textContent).toBe("DH");
  });

  test("Initials from single-name 'Daniel' → 'DA' (first 2 letters)", () => {
    render(<Avatar id="user-2" label="Daniel" />);
    expect(screen.getByRole("img", { name: "Daniel" }).textContent).toBe("DA");
  });

  test("Initials from email 'alice@example.com' → 'AL' (first 2 letters)", () => {
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
