import { describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { fireEvent, render as renderTree, screen, waitFor } from "@testing-library/react";
import { defaultTranslations } from "../i18n.ts";
import { WaitlistSubmitScreen } from "../waitlist-submit-screen.tsx";

function dispatcherAnswering(isSuccess: boolean) {
  const write = mock(async (_type: string, _payload: unknown) =>
    isSuccess
      ? { isSuccess: true, data: { kind: "submitted" } }
      : { isSuccess: false, error: { code: "validation_failed" } },
  );
  return { write, dispatcher: { write } as unknown as Dispatcher };
}

function fill(id: string, value: string): void {
  fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });
}

const resolver = createStaticLocaleResolver({ locale: "en" });

function render(dispatcher: Dispatcher) {
  return renderTree(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider resolver={resolver} fallbackBundles={[defaultTranslations]}>
        <DispatcherProvider dispatcher={dispatcher}>
          <WaitlistSubmitScreen />
        </DispatcherProvider>
      </LocaleProvider>
    </PrimitivesProvider>,
  );
}

describe("WaitlistSubmitScreen", () => {
  test("submits the entered fields anonymously and then shows the confirmation", async () => {
    const { write, dispatcher } = dispatcherAnswering(true);
    render(dispatcher);
    fill("waitlist-name", "Ada");
    fill("waitlist-email", "ada@example.com");
    fill("waitlist-company", "Analytical");
    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));

    await waitFor(() => expect(screen.getByText("You are on the list")).toBeTruthy());
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe("waitlist:write:submit");
    expect(write.mock.calls[0]?.[1]).toMatchObject({
      name: "Ada",
      email: "ada@example.com",
      company: "Analytical",
      locale: "en",
    });
    expect(document.getElementById("waitlist-email")).toBeNull();
  });

  test("a filled honeypot travels with the payload so the server can drop it", async () => {
    const { write, dispatcher } = dispatcherAnswering(true);
    render(dispatcher);
    fill("waitlist-name", "Bot");
    fill("waitlist-email", "bot@example.com");
    fill("waitlist-website", "http://spam.test");
    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(write.mock.calls[0]?.[1]).toMatchObject({ website: "http://spam.test" });
  });

  test("a rejected submit keeps the form and shows an error", async () => {
    const { dispatcher } = dispatcherAnswering(false);
    render(dispatcher);
    fill("waitlist-name", "Ada");
    fill("waitlist-email", "ada@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    await waitFor(() => expect(screen.getByText(/That did not work/)).toBeTruthy());
    expect(document.getElementById("waitlist-email")).toBeTruthy();
  });
});
