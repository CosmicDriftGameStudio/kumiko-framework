import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { Link } = defaultPrimitives;

describe("DefaultLink", () => {
  test("default rendering unchanged: href + variant class, no data attributes", () => {
    render(
      <Link href="/settings" testId="lnk">
        Settings
      </Link>,
    );
    const link = screen.getByTestId("lnk");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/settings");
    expect(link.className).toContain("text-primary");
  });

  test("dataAttributes forwards data-* attributes to the <a>, e.g. for a Designer file link", () => {
    render(
      <Link href="#some-file" testId="lnk" dataAttributes={{ "data-path": "some-file.tsx" }}>
        some-file.tsx
      </Link>,
    );
    expect(screen.getByTestId("lnk").getAttribute("data-path")).toBe("some-file.tsx");
  });
});
