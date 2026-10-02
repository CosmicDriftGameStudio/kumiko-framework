import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  createSessionEndedSignal,
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
  SessionEndedSignalProvider,
} from "@cosmicdrift/kumiko-renderer";
import { render, screen, waitFor } from "@testing-library/react";
import { AppSchemaFetchBoot, fetchAppSchema } from "../app/app-schema-boot.js";
import { defaultPrimitives } from "../primitives/index.js";

const originalFetch = globalThis.fetch;

function respondWith(status: number): void {
  globalThis.fetch = mock(
    async () => new Response(null, { status }),
  ) as unknown as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchAppSchema", () => {
  test("401 → session-ended", async () => {
    respondWith(401);
    expect(await fetchAppSchema(new AbortController().signal)).toEqual({ kind: "session-ended" });
  });

  test("403 stays unauthorized", async () => {
    respondWith(403);
    expect(await fetchAppSchema(new AbortController().signal)).toEqual({ kind: "unauthorized" });
  });
});

describe("AppSchemaFetchBoot session-ended signal", () => {
  function mountBoot(status: number) {
    respondWith(status);
    const signal = createSessionEndedSignal();
    const listener = mock(() => {});
    signal.subscribe(listener);
    render(
      <PrimitivesProvider value={defaultPrimitives}>
        <LocaleProvider
          resolver={createStaticLocaleResolver({ locale: "en" })}
          fallbackBundles={[kumikoDefaultTranslations]}
        >
          <SessionEndedSignalProvider signal={signal}>
            <AppSchemaFetchBoot onLoaded={() => {}} />
          </SessionEndedSignalProvider>
        </LocaleProvider>
      </PrimitivesProvider>,
    );
    return listener;
  }

  test("401 notifies the signal and still renders the unauthorized banner as fallback", async () => {
    const listener = mountBoot(401);
    await waitFor(() => expect(screen.getByText("You need to sign in to see this.")).toBeTruthy());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("403 does not notify the signal", async () => {
    const listener = mountBoot(403);
    await waitFor(() => expect(screen.getByText("You need to sign in to see this.")).toBeTruthy());
    expect(listener).not.toHaveBeenCalled();
  });
});
