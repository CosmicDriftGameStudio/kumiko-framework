import { afterEach, describe, test } from "bun:test";
import { createStaticLocaleResolver, LocaleProvider } from "@cosmicdrift/kumiko-renderer";
import { cleanup, render, screen } from "@testing-library/react";
import { defaultTranslations } from "./default-translations.ts";
import { SessionDeviceCell } from "./session-device-cell.tsx";

afterEach(cleanup);

function renderCell(value: unknown): void {
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[defaultTranslations]}
    >
      <SessionDeviceCell value={value} row={{}} column={{ field: "deviceLabel" }} />
    </LocaleProvider>,
  );
}

describe("SessionDeviceCell", () => {
  test("shows the server-formatted label as is", () => {
    renderCell("Chrome 141 · macOS");
    screen.getByText("Chrome 141 · macOS");
  });

  test("formats the parsed device object of a device column", () => {
    renderCell({ browser: "Firefox", browserMajor: 132, os: "macOS" });
    screen.getByText("Firefox 132 · macOS");
  });

  test("shows the translated fallback for an object without any recognised part", () => {
    renderCell({ browser: null, browserMajor: null, os: null });
    screen.getByText("Unknown device");
  });

  test("shows the translated fallback without a label", () => {
    renderCell(null);
    screen.getByText("Unknown device");
  });
});
