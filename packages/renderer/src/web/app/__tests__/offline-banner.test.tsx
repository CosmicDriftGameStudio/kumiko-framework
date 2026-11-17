import { afterEach, describe, expect, test } from "bun:test";
import { act, screen } from "@testing-library/react";
import { DispatcherProvider } from "../../../context/dispatcher-context.tsx";
import { createMockDispatcher, render } from "../../__tests__/test-utils.tsx";
import { OfflineBanner } from "../offline-banner.tsx";

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
