import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, screen } from "@testing-library/react";
import { DispatcherProvider } from "../../../context/dispatcher-context.tsx";
import { createMockDispatcher, render } from "../../__tests__/test-utils.tsx";
import { OfflineBanner } from "../offline-banner.tsx";

const STYLES_CSS = resolve(dirname(fileURLToPath(import.meta.url)), "../../styles.css");
const OFFLINE_TEXT = "No connection to the server. The data shown may be out of date.";

describe("OfflineBanner", () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, "onLine");
  afterEach(() => {
    if (originalOnLine) Object.defineProperty(navigator, "onLine", originalOnLine);
    else Reflect.deleteProperty(navigator, "onLine");
  });

  test("shows while the dispatcher status is offline", () => {
    const dispatcher = createMockDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <OfflineBanner />
      </DispatcherProvider>,
    );
    expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();

    act(() => dispatcher.statusStore.setState("offline"));
    expect(screen.getByRole("status").textContent).toContain(OFFLINE_TEXT);

    act(() => dispatcher.statusStore.setState("online"));
    expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();
  });

  test("the banner sits in the page flow and the shell makes room for it instead of being covered", async () => {
    const dispatcher = createMockDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <OfflineBanner />
      </DispatcherProvider>,
    );
    act(() => dispatcher.statusStore.setState("offline"));
    const banner = screen.getByText(OFFLINE_TEXT);
    expect(banner.hasAttribute("data-kumiko-offline-banner")).toBe(true);
    expect(banner.className).not.toContain("fixed");
    expect(banner.className).toContain("h-(--kumiko-offline-banner-height)");

    const css = await readFile(STYLES_CSS, "utf8");
    const bannerRules = css.slice(css.indexOf(":root:has([data-kumiko-offline-banner])"));
    expect(bannerRules).toContain("--kumiko-offline-banner-height:");
    // The fixed sidebar and every viewport-fit shell start below the banner.
    expect(bannerRules).toMatch(
      /\[data-slot="sidebar-container"\][^{]*\{[^}]*top: var\(--kumiko-offline-banner-height\)/,
    );
    expect(bannerRules).toMatch(
      /\[data-kumiko-fill="true"\][^{]*\{[^}]*height: calc\(100svh - var\(--kumiko-offline-banner-height\)\)/,
    );
    // Drawers and toasts placed below the header move down with it.
    expect(css).toMatch(
      /--shell-header-height: calc\(3\.5rem \+ var\(--kumiko-offline-banner-height\)\)/,
    );
  });

  test("shows when the browser reports no network", () => {
    const dispatcher = createMockDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <OfflineBanner />
      </DispatcherProvider>,
    );
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    screen.getByText(OFFLINE_TEXT);
  });
});
