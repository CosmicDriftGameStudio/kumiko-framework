import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  PWA_SERVICE_WORKER_META_NAME,
  pwaCacheScopePrefixOf,
} from "../../../headless/pwa-service-worker-meta.ts";
import { BasePathProvider } from "../../../index.ts";
import { render } from "../../__tests__/test-utils.tsx";
import { PWA_INSTALL_HINT_DISMISSED_KEY, PwaSupport } from "../pwa-support.tsx";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

const stubbedNavigatorKeys = ["serviceWorker", "userAgent", "maxTouchPoints", "standalone"];
const originalMatchMedia = window.matchMedia;
let register: ReturnType<typeof mock>;

function stubNavigator(key: string, value: unknown): void {
  Object.defineProperty(navigator, key, { configurable: true, value });
}

function stubStandaloneDisplayMode(standalone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

function addServiceWorkerMeta(workerUrl = "/sw.js"): void {
  const meta = document.createElement("meta");
  meta.name = PWA_SERVICE_WORKER_META_NAME;
  meta.content = workerUrl;
  document.head.append(meta);
}

function fireBeforeInstallPrompt(prompt = mock(async () => undefined)) {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

beforeEach(() => {
  register = mock(async () => ({}));
  stubNavigator("serviceWorker", { register });
  stubNavigator("userAgent", ANDROID_UA);
  stubNavigator("maxTouchPoints", 0);
  stubStandaloneDisplayMode(false);
  window.localStorage.clear();
});

afterEach(() => {
  for (const key of stubbedNavigatorKeys) Reflect.deleteProperty(navigator, key);
  window.matchMedia = originalMatchMedia;
  document.querySelector(`meta[name="${PWA_SERVICE_WORKER_META_NAME}"]`)?.remove();
  window.localStorage.clear();
});

describe("PwaSupport without the pwa option", () => {
  test("registers nothing and never shows a hint", () => {
    render(<PwaSupport />);
    fireBeforeInstallPrompt();
    expect(register).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("PwaSupport without the pwa option and a leftover worker", () => {
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  let unregister: ReturnType<typeof mock>;
  let deleteCache: ReturnType<typeof mock>;
  let listCaches: ReturnType<typeof mock>;

  function stubWorkerState(
    scriptURL: string,
    cacheNames: string[],
    scope = "https://app.test/",
  ): void {
    unregister = mock(async () => true);
    deleteCache = mock(async () => true);
    listCaches = mock(async () => cacheNames);
    stubNavigator("serviceWorker", {
      register,
      getRegistration: async () => ({ active: { scriptURL }, scope, unregister }),
    });
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { keys: listCaches, delete: deleteCache },
    });
  }

  afterEach(() => {
    if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
    else Reflect.deleteProperty(globalThis, "caches");
  });

  test("unregisters the shell worker and drops its caches when the marker cache exists", async () => {
    const ownCache = `${await pwaCacheScopePrefixOf("/")}0123`;
    stubWorkerState("https://app.test/sw.js", [ownCache, "other-app-cache"]);
    render(<PwaSupport />);
    await waitFor(() => expect(unregister).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(deleteCache).toHaveBeenCalledTimes(1));
    expect(deleteCache).toHaveBeenCalledWith(ownCache);
  });

  test("an own-scope cache under a base path is matched by that scope's prefix", async () => {
    const ownCache = `${await pwaCacheScopePrefixOf("/a/")}0123`;
    stubWorkerState("https://app.test/a/sw.js", [ownCache], "https://app.test/a/");
    render(
      <BasePathProvider basePath="/a">
        <PwaSupport />
      </BasePathProvider>,
    );
    await waitFor(() => expect(unregister).toHaveBeenCalledTimes(1));
    expect(deleteCache).toHaveBeenCalledWith(ownCache);
  });

  test("leaves an enclosing app's worker alone when this app sits under a sub path", async () => {
    const enclosingCache = `${await pwaCacheScopePrefixOf("/")}0123`;
    stubWorkerState("https://app.test/sw.js", [enclosingCache], "https://app.test/");
    render(
      <BasePathProvider basePath="/b">
        <PwaSupport />
      </BasePathProvider>,
    );
    await act(async () => undefined);
    expect(unregister).not.toHaveBeenCalled();
    expect(deleteCache).not.toHaveBeenCalled();
  });

  test("leaves the worker and another app's kumiko-pwa- cache alone", async () => {
    stubWorkerState("https://app.test/sw.js", ["kumiko-pwa-ffffffff-0123"]);
    render(<PwaSupport />);
    await waitFor(() => expect(listCaches).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(unregister).not.toHaveBeenCalled();
    expect(deleteCache).not.toHaveBeenCalled();
  });

  test("leaves an app-owned worker alone when no kumiko-pwa- cache exists", async () => {
    stubWorkerState("https://app.test/sw.js", ["other-app-cache"]);
    render(<PwaSupport />);
    await waitFor(() => expect(listCaches).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(unregister).not.toHaveBeenCalled();
    expect(deleteCache).not.toHaveBeenCalled();
  });
});

describe("PwaSupport with the pwa option", () => {
  beforeEach(addServiceWorkerMeta);

  test("registers the service worker from the shell meta for the whole origin", async () => {
    render(<PwaSupport />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
  });

  test("the scope is the directory of the worker url under a base path", async () => {
    document.querySelector(`meta[name="${PWA_SERVICE_WORKER_META_NAME}"]`)?.remove();
    addServiceWorkerMeta("/a/sw.js");
    render(<PwaSupport />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledWith("/a/sw.js", { scope: "/a/", updateViaCache: "none" });
  });

  test("a failing registration does not break the app", async () => {
    register.mockImplementation(async () => {
      throw new Error("SecurityError");
    });
    render(<PwaSupport />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("no hint before the browser offers an install", () => {
    render(<PwaSupport />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("beforeinstallprompt shows the hint, Install opens the browser prompt once", async () => {
    render(<PwaSupport />);
    const { event, prompt } = fireBeforeInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
    expect(
      screen.getByText("Install this app on your device to open it like any other app."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).toBeNull();
    expect(window.localStorage.getItem(PWA_INSTALL_HINT_DISMISSED_KEY)).toBe("1");
  });

  test("Not now hides the hint and it stays away on the next visit", () => {
    const { unmount } = render(<PwaSupport />);
    fireBeforeInstallPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("status")).toBeNull();
    unmount();

    render(<PwaSupport />);
    const { event } = fireBeforeInstallPrompt();
    expect(screen.queryByRole("status")).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  test("appinstalled hides the hint for good", () => {
    render(<PwaSupport />);
    fireBeforeInstallPrompt();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(window.localStorage.getItem(PWA_INSTALL_HINT_DISMISSED_KEY)).toBe("1");
  });

  test("an iPhone gets the Add to Home Screen hint without an install button", () => {
    stubNavigator("userAgent", IPHONE_UA);
    render(<PwaSupport />);
    expect(
      screen.getByText("To install this app, tap Share and then “Add to Home Screen”."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(window.localStorage.getItem(PWA_INSTALL_HINT_DISMISSED_KEY)).toBe("1");
  });

  test("an iPad with its desktop user agent gets the same hint", () => {
    stubNavigator("userAgent", IPAD_DESKTOP_UA);
    stubNavigator("maxTouchPoints", 5);
    render(<PwaSupport />);
    expect(
      screen.getByText("To install this app, tap Share and then “Add to Home Screen”."),
    ).toBeTruthy();
  });

  test("a desktop Mac without touch is not treated as iOS", () => {
    stubNavigator("userAgent", IPAD_DESKTOP_UA);
    render(<PwaSupport />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("running standalone shows no hint but still registers the worker", async () => {
    stubStandaloneDisplayMode(true);
    render(<PwaSupport />);
    fireBeforeInstallPrompt();
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });

  test("an iOS home screen app (navigator.standalone) shows no hint", () => {
    stubNavigator("userAgent", IPHONE_UA);
    stubNavigator("standalone", true);
    render(<PwaSupport />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("blocked storage still shows the hint and dismissing it does not throw", () => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new Error("SecurityError");
    };
    try {
      render(<PwaSupport />);
      fireBeforeInstallPrompt();
      expect(screen.getByRole("status")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      Storage.prototype.getItem = getItem;
      Storage.prototype.setItem = setItem;
    }
  });
});
