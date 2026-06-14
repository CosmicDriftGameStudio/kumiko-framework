import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, screen } from "@testing-library/react";
import { createContext, type ReactNode, useContext } from "react";
import type { ClientFeatureDefinition } from "../app/client-plugin";
import { createPublicSurface } from "../app/create-public-surface";
import { createMockDispatcher } from "./test-utils";

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

  test("rendert die Route deren path auf den aktuellen Pfad matcht", async () => {
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

  test("ohne Match → fallback", async () => {
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

  test("injectSchema:false — ignoriert window.__KUMIKO_SCHEMA__ komplett (kein Topologie-Leak)", async () => {
    // Ein Admin-Schema im Window darf NICHT zu gerenderter Admin-Nav/
    // Topologie führen — die Surface liest das Global gar nicht, sie
    // rendert ausschließlich die deklarierte Route.
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

  test("clientFeatures: providers werden gestackt, gates aber NICHT (Surface bleibt öffentlich)", async () => {
    const Ctx = createContext("absent");
    function MarkerProvider({ children }: { readonly children: ReactNode }): ReactNode {
      return <Ctx.Provider value="present">{children}</Ctx.Provider>;
    }
    function HideEverythingGate(): ReactNode {
      return <div data-testid="gate-hijack">gate</div>;
    }
    function ProbeRoute(): ReactNode {
      return <div data-testid="probe">{useContext(Ctx)}</div>;
    }
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
    // Provider sichtbar (Context greift), Gate nicht angewandt.
    expect(screen.getByTestId("probe").textContent).toBe("present");
    expect(screen.queryByTestId("gate-hijack")).toBeNull();
  });

  test("shell wrappt den gematchten Content (Page-Chrome)", async () => {
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

  test("fehlendes #root → wirft mit hilfreicher Message", () => {
    expect(() => createPublicSurface({ dispatcher: dispatcher(), routes: [] })).toThrow(
      /#root not found/,
    );
  });
});
