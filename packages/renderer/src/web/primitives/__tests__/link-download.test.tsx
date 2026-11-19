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

  test("allows data:text/calendar hrefs with and without parameters", () => {
    for (const href of [
      "data:text/calendar,BEGIN%3AVCALENDAR",
      "data:text/calendar;charset=utf-8,BEGIN%3AVCALENDAR",
    ]) {
      const view = render(
        <Link download="event.ics" href={href} testId="link">
          Save
        </Link>,
      );
      expect(screen.getByTestId("link").getAttribute("href")).toBe(href);
      view.unmount();
    }
  });

  test("blocks other data: types and calendar look-alikes", () => {
    for (const href of [
      "data:text/html,<p>x</p>",
      "data:text/calendar-x,BEGIN",
      "data:text/calendarx;charset=utf-8,BEGIN",
      "data:text/calendar+html,BEGIN",
    ]) {
      const view = render(
        <Link download="event.ics" href={href} testId="link">
          Save
        </Link>,
      );
      expect(screen.getByTestId("link").getAttribute("href")).toBe("#");
      view.unmount();
    }
  });

  test("still blocks javascript: hrefs", () => {
    const scheme = "javascript";
    render(
      <Link download="x" href={`${scheme}:alert(1)`} testId="link">
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
