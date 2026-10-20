import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  ROOT_ERROR_FALLBACK_TEST_ID,
  SCREEN_ERROR_FALLBACK_TEST_ID,
} from "@cosmicdrift/kumiko-types/error-boundary";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FeatureSchema } from "../../index.ts";
import { type CreateKumikoAppOptions, createKumikoApp } from "../app/create-app.tsx";
import { createMockDispatcher } from "./test-utils.tsx";

const schema: FeatureSchema = {
  featureName: "probe",
  entities: {},
  screens: [
    { id: "boom", type: "custom", renderer: { react: { __component: "Boom" } } },
    { id: "calm", type: "custom", renderer: { react: { __component: "Calm" } } },
  ],
  navs: [],
};

let boomShouldThrow = true;

function Boom(): ReactNode {
  if (boomShouldThrow) throw new Error("kaputt-im-render");
  return <span data-testid="boom-recovered" />;
}

function Calm(): ReactNode {
  return <span data-testid="calm-mounted" />;
}

function Shell({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div>
      <nav data-testid="shell-nav">navigation</nav>
      <main>{children}</main>
    </div>
  );
}

let appRoot: { unmount: () => void } | undefined;

async function mountApp(options: CreateKumikoAppOptions): Promise<void> {
  const container = document.createElement("div");
  container.id = "root";
  document.body.appendChild(container);
  await act(async () => {
    appRoot = createKumikoApp({ dispatcher: createMockDispatcher({}), ...options }).root;
  });
}

function setNodeEnv(value: string | undefined): void {
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
}

describe("renderer error boundaries", () => {
  let errorSpy: ReturnType<typeof spyOn<Console, "error">>;

  beforeEach(() => {
    boomShouldThrow = true;
    window.history.replaceState(null, "", "/boom");
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => appRoot?.unmount());
    appRoot = undefined;
    document.body.replaceChildren();
    errorSpy.mockRestore();
  });

  test("a throwing screen shows the fallback card, keeps the shell, logs, and resets on reload", async () => {
    await mountApp({
      schema,
      screenQn: "probe:screen:boom",
      shell: ({ children }) => <Shell>{children}</Shell>,
      clientFeatures: [{ name: "probe", components: { boom: Boom, calm: Calm } }],
    });

    const fallback = await screen.findByTestId(SCREEN_ERROR_FALLBACK_TEST_ID);
    expect(fallback.textContent).toContain("probe:screen:boom");
    expect(fallback.textContent).toContain("kaputt-im-render");
    expect(screen.getByTestId("shell-nav")).toBeTruthy();
    expect(
      errorSpy.mock.calls.some(
        (call) => String(call[0]).includes("screen error boundary") && call[1] instanceof Error,
      ),
    ).toBe(true);

    boomShouldThrow = false;
    fireEvent.click(screen.getByTestId(`${SCREEN_ERROR_FALLBACK_TEST_ID}-reset`));
    expect(await screen.findByTestId("boom-recovered")).toBeTruthy();
    expect(screen.queryByTestId(SCREEN_ERROR_FALLBACK_TEST_ID)).toBeNull();
  });

  test.each([
    ["a production build", "production"],
    ["a bundle without NODE_ENV", undefined],
  ])(
    "in %s the card hides the error message but keeps the screen name",
    async (_label, nodeEnv) => {
      const previousEnv = process.env.NODE_ENV;
      setNodeEnv(nodeEnv);
      try {
        await mountApp({
          schema,
          screenQn: "probe:screen:boom",
          shell: ({ children }) => <Shell>{children}</Shell>,
          clientFeatures: [{ name: "probe", components: { boom: Boom, calm: Calm } }],
        });
        const fallback = await screen.findByTestId(SCREEN_ERROR_FALLBACK_TEST_ID);
        expect(fallback.textContent).toContain("probe:screen:boom");
        expect(fallback.textContent).not.toContain("kaputt-im-render");
      } finally {
        setNodeEnv(previousEnv);
      }
    },
  );

  test("onError option receives the error caught by the screen boundary", async () => {
    const seen: string[] = [];
    await mountApp({
      schema,
      screenQn: "probe:screen:boom",
      onError: (error) => seen.push(error.message),
      clientFeatures: [{ name: "probe", components: { boom: Boom, calm: Calm } }],
    });
    await screen.findByTestId(SCREEN_ERROR_FALLBACK_TEST_ID);
    expect(seen).toEqual(["kaputt-im-render"]);
  });

  test("an onError handler that throws neither unmounts the shell nor replaces the fallback card", async () => {
    await mountApp({
      schema,
      screenQn: "probe:screen:boom",
      onError: () => {
        throw new Error("telemetry-kaputt");
      },
      shell: ({ children }) => <Shell>{children}</Shell>,
      clientFeatures: [{ name: "probe", components: { boom: Boom, calm: Calm } }],
    });

    const fallback = await screen.findByTestId(SCREEN_ERROR_FALLBACK_TEST_ID);
    expect(fallback.textContent).toContain("kaputt-im-render");
    expect(screen.getByTestId("shell-nav")).toBeTruthy();
    expect(screen.queryByTestId(ROOT_ERROR_FALLBACK_TEST_ID)).toBeNull();
    expect(
      errorSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("screen error boundary") &&
          call[1] instanceof Error &&
          call[1].message === "telemetry-kaputt",
      ),
    ).toBe(true);
  });

  test("navigating to another screen clears the fallback without a reload click", async () => {
    await mountApp({
      schema,
      screenQn: "probe:screen:boom",
      shell: ({ children }) => <Shell>{children}</Shell>,
      clientFeatures: [{ name: "probe", components: { boom: Boom, calm: Calm } }],
    });
    await screen.findByTestId(SCREEN_ERROR_FALLBACK_TEST_ID);

    act(() => {
      window.history.pushState(null, "", "/calm");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => expect(screen.getByTestId("calm-mounted")).toBeTruthy());
    expect(screen.queryByTestId(SCREEN_ERROR_FALLBACK_TEST_ID)).toBeNull();
    expect(screen.getByTestId("shell-nav")).toBeTruthy();
  });

  test("an error above the screen (provider) is caught by the root boundary without needing providers", async () => {
    function ThrowingProvider(): ReactNode {
      throw new Error("provider-kaputt");
    }
    await mountApp({
      schema,
      screenQn: "probe:screen:calm",
      clientFeatures: [
        { name: "probe", components: { calm: Calm }, providers: [ThrowingProvider] },
      ],
    });

    expect(await screen.findByTestId(ROOT_ERROR_FALLBACK_TEST_ID)).toBeTruthy();
    expect(
      errorSpy.mock.calls.some(
        (call) => String(call[0]).includes("root error boundary") && call[1] instanceof Error,
      ),
    ).toBe(true);
  });

  describe("client error reporting", () => {
    type Recorded = { readonly url: string; readonly init: RequestInit };
    let calls: Recorded[];
    let originalFetch: typeof fetch;

    beforeEach(() => {
      calls = [];
      originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 204 });
      }) as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    const reportsOnly = (): Recorded[] => calls.filter((c) => c.url === "/api/client-errors");

    test("a screen error is reported once with the same errorId the fallback shows", async () => {
      await mountApp({
        schema,
        screenQn: "probe:screen:boom",
        clientFeatures: [{ name: "probe", components: { boom: Boom, calm: Calm } }],
      });
      const fallback = await screen.findByTestId(SCREEN_ERROR_FALLBACK_TEST_ID);
      const reports = reportsOnly();
      expect(reports).toHaveLength(1);
      const body = JSON.parse(String(reports[0]?.init.body));
      expect(body).toMatchObject({
        kind: "render",
        message: "kaputt-im-render",
        screen: "probe:screen:boom",
        path: "/boom",
      });
      expect(fallback.textContent).toContain(body.errorId);
    });

    test("reportClientErrors:false sends nothing", async () => {
      await mountApp({
        schema,
        screenQn: "probe:screen:boom",
        reportClientErrors: false,
        clientFeatures: [{ name: "probe", components: { boom: Boom, calm: Calm } }],
      });
      await screen.findByTestId(SCREEN_ERROR_FALLBACK_TEST_ID);
      expect(reportsOnly()).toHaveLength(0);
    });

    test("a custom onError runs in addition to the report and receives the errorId", async () => {
      const seen: string[] = [];
      await mountApp({
        schema,
        screenQn: "probe:screen:boom",
        onError: (_error, _info, context) => seen.push(context.errorId),
        clientFeatures: [{ name: "probe", components: { boom: Boom, calm: Calm } }],
      });
      await screen.findByTestId(SCREEN_ERROR_FALLBACK_TEST_ID);
      const body = JSON.parse(String(reportsOnly()[0]?.init.body));
      expect(seen).toEqual([body.errorId]);
    });

    test("the root fallback shows the errorId and copies it", async () => {
      function ThrowingProvider(): ReactNode {
        throw new Error("provider-kaputt");
      }
      const written: string[] = [];
      const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => void written.push(text) },
      });
      try {
        await mountApp({
          schema,
          screenQn: "probe:screen:calm",
          clientFeatures: [
            { name: "probe", components: { calm: Calm }, providers: [ThrowingProvider] },
          ],
        });
        const fallback = await screen.findByTestId(ROOT_ERROR_FALLBACK_TEST_ID);
        const body = JSON.parse(String(reportsOnly()[0]?.init.body));
        expect(body.screen).toBeUndefined();
        expect(fallback.textContent).toContain(body.errorId);
        await act(async () => {
          fireEvent.click(screen.getByTestId(`${ROOT_ERROR_FALLBACK_TEST_ID}-copy`));
        });
        expect(written).toEqual([body.errorId]);
      } finally {
        if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      }
    });
  });
});
