import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, screen } from "@testing-library/react";
import { createContext, type ReactNode, useContext } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, useTranslation } from "../../index.ts";
import type { ClientFeatureDefinition } from "../app/client-plugin.tsx";
import { createPublicSurface } from "../app/create-public-surface.tsx";
import { createMockDispatcher } from "./test-utils.tsx";

function mountRoot(id = "root"): HTMLDivElement {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const root = document.createElement("div");
  root.id = id;
  document.body.appendChild(root);
  return root as HTMLDivElement;
}

function setPath(path: string): void {
  window.history.replaceState({}, "", path);
}

function dispatcher(): Dispatcher {
  return createMockDispatcher({});
}

let appRoot: { unmount: () => void } | undefined;

async function mount(options: Parameters<typeof createPublicSurface>[0]): Promise<void> {
  await act(async () => {
    appRoot = createPublicSurface(options).root;
  });
}

function Greeting(): ReactNode {
  const t = useTranslation();
  return <p data-testid="greeting">{t("public.greeting")}</p>;
}

function HideEverythingGate(): ReactNode {
  return <div data-testid="gate-hijack">gate</div>;
}

const Ctx = createContext("absent");

function MarkerProvider({ children }: { readonly children: ReactNode }): ReactNode {
  return <Ctx.Provider value="present">{children}</Ctx.Provider>;
}

function ProbeRoute(): ReactNode {
  return <div data-testid="probe">{useContext(Ctx)}</div>;
}

describe("createPublicSurface", () => {
  afterEach(() => {
    if (appRoot !== undefined) {
      act(() => {
        // biome-ignore lint/style/noNonNullAssertion: TS can't narrow inside act() callback
        appRoot!.unmount();
      });
      appRoot = undefined;
    }
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    delete (window as unknown as { __KUMIKO_SCHEMA__?: unknown }).__KUMIKO_SCHEMA__;
    setPath("/");
  });

  afterAll(() => {
    delete (window as unknown as { __KUMIKO_SCHEMA__?: unknown }).__KUMIKO_SCHEMA__;
  });

  test("renders the route whose path matches the current path", async () => {
    setPath("/login");
    mountRoot();
    await mount({
      dispatcher: dispatcher(),
      routes: [
        { path: "/login", component: <div data-testid="login">login</div> },
        { path: "/signup", component: <div data-testid="signup">signup</div> },
      ],
    });
    expect(screen.getByTestId("login")).toBeTruthy();
    expect(screen.queryByTestId("signup")).toBeNull();
  });

  test("no match → fallback", async () => {
    setPath("/nope");
    mountRoot();
    await mount({
      dispatcher: dispatcher(),
      routes: [{ path: "/login", component: <div data-testid="login">login</div> }],
      fallback: <div data-testid="fallback">fallback</div>,
    });
    expect(screen.getByTestId("fallback")).toBeTruthy();
    expect(screen.queryByTestId("login")).toBeNull();
  });

  test("ignores window.__KUMIKO_SCHEMA__ entirely (no topology leak)", async () => {
    // An admin schema on `window` must not lead to a rendered admin nav or
    // topology: the surface never reads the global and renders only the
    // declared route.
    setPath("/login");
    (window as unknown as { __KUMIKO_SCHEMA__?: unknown }).__KUMIKO_SCHEMA__ = {
      features: [
        {
          featureName: "secret-admin",
          entities: {},
          screens: [{ id: "secret-topology", type: "custom" }],
        },
      ],
    };
    mountRoot();
    await mount({
      dispatcher: dispatcher(),
      routes: [{ path: "/login", component: <div data-testid="login">login</div> }],
    });
    expect(screen.getByTestId("login")).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret");
    expect(document.body.textContent).not.toContain("topology");
  });

  test("clientFeatures: providers are stacked, but gates are NOT (surface remains public)", async () => {
    const feature: ClientFeatureDefinition = {
      name: "auth",
      providers: [MarkerProvider],
      gates: [HideEverythingGate],
    };
    setPath("/login");
    mountRoot();
    await mount({
      dispatcher: dispatcher(),
      clientFeatures: [feature],
      routes: [{ path: "/login", component: <ProbeRoute /> }],
    });
    // The provider is visible (its context applies); the gate is not applied.
    expect(screen.getByTestId("probe").textContent).toBe("present");
    expect(screen.queryByTestId("gate-hijack")).toBeNull();
  });

  test("shell wraps the matched content (Page-Chrome)", async () => {
    setPath("/login");
    mountRoot();
    await mount({
      dispatcher: dispatcher(),
      routes: [{ path: "/login", component: <div data-testid="login">login</div> }],
      shell: ({ children }) => <div data-testid="chrome">{children}</div>,
    });
    const chrome = screen.getByTestId("chrome");
    expect(chrome.querySelector("[data-testid=login]")).not.toBeNull();
  });

  test("formality: formal makes every page of the surface use the -x-formal wording", async () => {
    const withGreeting: ClientFeatureDefinition = {
      name: "greeting",
      translations: {
        de: { "public.greeting": "Schön, dass du da bist" },
        "de-x-formal": { "public.greeting": "Schön, dass Sie da sind" },
      },
    };
    setPath("/");
    mountRoot();
    await mount({
      dispatcher: dispatcher(),
      locale: createStaticLocaleResolver({ locale: "de" }),
      clientFeatures: [withGreeting],
      formality: "formal",
      routes: [{ path: "/", component: <Greeting /> }],
    });
    expect(screen.getByTestId("greeting").textContent).toBe("Schön, dass Sie da sind");
  });

  test("missing #root → throws with helpful message", () => {
    expect(() => createPublicSurface({ dispatcher: dispatcher(), routes: [] })).toThrow(
      /#root not found/,
    );
  });
});
