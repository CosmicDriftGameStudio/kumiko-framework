import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { AccentScope, accentColorVars } from "../accent-scope.tsx";

describe("accentColorVars", () => {
  test("tints with a light foreground on a dark accent", () => {
    expect(accentColorVars("#7c3aed")).toEqual({
      "--color-primary": "#7c3aed",
      "--color-ring": "#7c3aed",
      "--color-primary-foreground": "#ffffff",
    });
  });

  test("uses the dark foreground on a bright accent", () => {
    expect(accentColorVars("#fde047")?.["--color-primary-foreground"]).toBe("#1a1c1e");
  });

  test("accepts the three-digit form", () => {
    const vars = accentColorVars("#abc");
    expect(vars?.["--color-primary"]).toBe("#abc");
    expect(vars?.["--color-primary-foreground"]).toBe("#1a1c1e");
  });

  test("accepts an alpha channel", () => {
    const vars = accentColorVars("#7c3aed80");
    expect(vars?.["--color-primary"]).toBe("#7c3aed80");
    expect(vars?.["--color-primary-foreground"]).toBe("#ffffff");
  });

  test("trims the value", () => {
    expect(accentColorVars(" #7c3aed ")?.["--color-primary"]).toBe("#7c3aed");
  });

  test("rejects everything that is not a hex color", () => {
    for (const value of ["", "red", "url(https://x.test/a.png)", "#12345", "#7c3aed;color:red"]) {
      expect(accentColorVars(value)).toBeUndefined();
    }
  });
});

describe("AccentScope", () => {
  test("sets the accent variables on its wrapper", () => {
    render(
      <AccentScope color="#7c3aed" className="shell" testId="scope">
        <span>Inhalt</span>
      </AccentScope>,
    );
    const scope = screen.getByTestId("scope");
    expect(scope.style.getPropertyValue("--color-primary")).toBe("#7c3aed");
    expect(scope.className).toBe("shell");
    expect(scope.textContent).toBe("Inhalt");
  });

  test("renders no style for an invalid color", () => {
    render(
      <AccentScope color="not-a-color" testId="scope">
        <span>Inhalt</span>
      </AccentScope>,
    );
    expect(screen.getByTestId("scope").getAttribute("style")).toBeNull();
  });
});
