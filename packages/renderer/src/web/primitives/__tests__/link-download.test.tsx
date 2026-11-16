import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index.tsx";

const { Link } = defaultPrimitives;

describe("DefaultLink download", () => {
  test("sets the download attribute and keeps a normal href", () => {
    render(
      <Link download="report.pdf" href="/api/files/1" testId="link">
        Save
      </Link>,
    );
    const link = screen.getByTestId("link");
    expect(link.getAttribute("download")).toBe("report.pdf");
    expect(link.getAttribute("href")).toBe("/api/files/1");
  });

  test("allows data:image and blob: hrefs", () => {
    for (const href of ["data:image/png;base64,AAAA", "blob:http://localhost/abc"]) {
      const view = render(
        <Link download="slide.png" href={href} testId="link">
          Save
        </Link>,
      );
      expect(screen.getByTestId("link").getAttribute("href")).toBe(href);
      view.unmount();
    }
  });

  test("still blocks javascript: hrefs", () => {
    render(
      <Link download="x" href="javascript:alert(1)" testId="link">
        Save
      </Link>,
    );
    expect(screen.getByTestId("link").getAttribute("href")).toBe("#");
  });

  test("without download a data:image href stays blocked", () => {
    render(
      <Link href="data:image/png;base64,AAAA" testId="link">
        Open
      </Link>,
    );
    expect(screen.getByTestId("link").getAttribute("href")).toBe("#");
  });
});
