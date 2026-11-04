import { describe, expect, test } from "bun:test";
import { createPwaShell, type PwaOptions } from "../pwa.ts";
import { PWA_CACHE_NAME_PREFIX } from "../pwa-service-worker-script.ts";
import {
  basicResponse,
  runServiceWorkerScript,
  SANDBOX_ORIGIN,
  type ServiceWorkerSandbox,
} from "./_pwa-service-worker-sandbox.ts";

const pwa: PwaOptions = {
  name: "Tasks Pro",
  shortName: "Tasks",
  themeColor: "#0f172a",
  backgroundColor: "#ffffff",
  icons: [
    { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/maskable-1024.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" },
  ],
};

const build = {
  appShellUrls: ["/assets/client-abc.js", "/assets/styles-def.css"],
  buildToken: "b1",
};

const SHELL_HTML = "<!doctype html><html><head><title>x</title></head><body></body></html>";

async function serviceWorkerOf(shell = createPwaShell(pwa, build)): Promise<ServiceWorkerSandbox> {
  const response = shell.respond(new Request(`${SANDBOX_ORIGIN}/sw.js`), "/sw.js");
  if (!response) throw new Error("no service worker response");
  return runServiceWorkerScript(await response.text());
}

describe("createPwaShell — options", () => {
  for (const src of [
    "//evil.example/icon.png",
    "https://evil.example/icon.png",
    "icons/192.png",
    "/\\evil.example/icon.png",
  ]) {
    test(`rejects icon src ${src} at boot`, () => {
      expect(() => createPwaShell({ ...pwa, icons: [{ src, sizes: "192x192" }] }, build)).toThrow(
        /same-origin path/,
      );
    });
  }
});

describe("createPwaShell — served files", () => {
  test("GET /manifest.webmanifest answers the manifest built from the options", async () => {
    const shell = createPwaShell(pwa, build);
    const res = shell.respond(
      new Request(`${SANDBOX_ORIGIN}/manifest.webmanifest`),
      "/manifest.webmanifest",
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("application/manifest+json");
    expect(res?.headers.get("cache-control")).toBe("no-cache");
    expect(await res?.json()).toEqual({
      id: "/",
      name: "Tasks Pro",
      short_name: "Tasks",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#0f172a",
      background_color: "#ffffff",
      icons: [
        { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
        {
          src: "/icons/maskable-1024.png",
          sizes: "1024x1024",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    });
  });

  test("GET /sw.js answers JavaScript that must be revalidated", () => {
    const res = createPwaShell(pwa, build).respond(
      new Request(`${SANDBOX_ORIGIN}/sw.js`),
      "/sw.js",
    );
    expect(res?.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res?.headers.get("cache-control")).toBe("no-cache");
  });

  test("HEAD answers the headers without a body", async () => {
    const res = createPwaShell(pwa, build).respond(
      new Request(`${SANDBOX_ORIGIN}/sw.js`, { method: "HEAD" }),
      "/sw.js",
    );
    expect(res?.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res?.text()).toBe("");
  });

  test("other paths and other methods are left to the normal routes", () => {
    const shell = createPwaShell(pwa, build);
    expect(
      shell.respond(new Request(`${SANDBOX_ORIGIN}/manifest.json`), "/manifest.json"),
    ).toBeUndefined();
    expect(
      shell.respond(new Request(`${SANDBOX_ORIGIN}/sw.js`, { method: "POST" }), "/sw.js"),
    ).toBeUndefined();
  });
});

describe("createPwaShell — head tags", () => {
  test("adds manifest, theme color, apple tags and the service worker meta before </head>", () => {
    const html = createPwaShell(pwa, build).injectHeadTags(SHELL_HTML);
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(head).toContain('<meta name="theme-color" content="#0f172a" />');
    expect(head).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(head).toContain('<meta name="apple-mobile-web-app-title" content="Tasks" />');
    expect(head).toContain('<meta name="kumiko-pwa-sw" content="/sw.js" />');
  });

  test("apple-touch-icon is the largest icon that is not maskable", () => {
    const html = createPwaShell(pwa, build).injectHeadTags(SHELL_HTML);
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/512.png" />');
  });

  test("option values are escaped and never read as replacement patterns", () => {
    const html = createPwaShell(
      { ...pwa, shortName: '$& "><script>x</script>', themeColor: "red' onload='x" },
      build,
    ).injectHeadTags(SHELL_HTML);
    expect(html).not.toContain("<script>");
    expect(html).toContain('content="$&amp; &quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
    expect(html).toContain('content="red&#39; onload=&#39;x"');
  });

  test("HTML without </head> stays as it is", () => {
    expect(createPwaShell(pwa, build).injectHeadTags("<div>fragment</div>")).toBe(
      "<div>fragment</div>",
    );
  });
});

describe("createPwaShell — cache name", () => {
  test("is stable for the same build and changes with a new build", () => {
    const first = createPwaShell(pwa, build).cacheName;
    expect(first.startsWith(PWA_CACHE_NAME_PREFIX)).toBe(true);
    expect(createPwaShell(pwa, build).cacheName).toBe(first);
    expect(createPwaShell(pwa, { ...build, buildToken: "b2" }).cacheName).not.toBe(first);
    expect(
      createPwaShell(pwa, { ...build, appShellUrls: ["/assets/client-new.js"] }).cacheName,
    ).not.toBe(first);
  });
});

describe("service worker — requests it leaves alone", () => {
  const passThrough: ReadonlyArray<readonly [string, { method?: string; accept?: string }]> = [
    ["/api/query", {}],
    ["/api", {}],
    ["/sse", {}],
    ["/sse/stream", {}],
    ["/auth/login", {}],
    ["/_reload", {}],
    ["/health", {}],
    ["/build-info.json", {}],
    ["/sw.js", {}],
    ["/assets/client-abc.js", { method: "POST" }],
    ["/assets/live.js", { accept: "text/event-stream" }],
    ["https://cdn.other.example/assets/lib.js", {}],
    ["/feed.xml", {}],
  ];
  for (const [path, init] of passThrough) {
    test(`${init.method ?? "GET"} ${path}${init.accept ? ` (${init.accept})` : ""}`, async () => {
      const worker = await serviceWorkerOf();
      expect(await worker.dispatchFetch(path, init)).toBeUndefined();
    });
  }

  test("an /api navigation is not answered either", async () => {
    const worker = await serviceWorkerOf();
    expect(await worker.dispatchFetch("/api/files/1", { mode: "navigate" })).toBeUndefined();
  });
});

describe("service worker — install and activate", () => {
  test("install caches shell, manifest, icons and bundles, then takes over at once", async () => {
    const shell = createPwaShell(pwa, build);
    const worker = await serviceWorkerOf(shell);
    await worker.install();
    const cached = [...(worker.cacheStore.get(shell.cacheName)?.keys() ?? [])].map(
      (url) => new URL(url).pathname,
    );
    expect(cached.sort()).toEqual(
      [
        "/",
        "/manifest.webmanifest",
        "/icons/192.png",
        "/icons/512.png",
        "/icons/maskable-1024.png",
        "/assets/client-abc.js",
        "/assets/styles-def.css",
      ].sort(),
    );
    expect(worker.calls.skipWaiting).toBe(1);
  });

  test("a missing or no-store file is skipped without failing the install", async () => {
    const shell = createPwaShell(pwa, build);
    const worker = await serviceWorkerOf(shell);
    worker.setNetwork((url) => {
      const path = new URL(url).pathname;
      if (path === "/icons/512.png") return basicResponse("missing", { status: 404 });
      if (path === "/icons/192.png") throw new TypeError("offline");
      if (path === "/") return basicResponse("shell", { headers: { "cache-control": "no-store" } });
      return basicResponse(path);
    });
    await worker.install();
    const cached = [...(worker.cacheStore.get(shell.cacheName)?.keys() ?? [])].map(
      (url) => new URL(url).pathname,
    );
    expect(cached).not.toContain("/icons/512.png");
    expect(cached).not.toContain("/icons/192.png");
    expect(cached).not.toContain("/");
    expect(cached).toContain("/assets/client-abc.js");
    expect(worker.calls.skipWaiting).toBe(1);
  });

  test("activate drops older kumiko caches, keeps foreign ones and claims the clients", async () => {
    const shell = createPwaShell(pwa, build);
    const worker = await serviceWorkerOf(shell);
    worker.cacheStore.set(`${PWA_CACHE_NAME_PREFIX}old`, new Map());
    worker.cacheStore.set("other-library-cache", new Map());
    await worker.install();
    await worker.activate();
    expect([...worker.cacheStore.keys()].sort()).toEqual(
      [shell.cacheName, "other-library-cache"].sort(),
    );
    expect(worker.calls.claim).toBe(1);
  });
});

describe("service worker — fetch strategies", () => {
  test("a navigation goes to the network while online, even when it fails with 500", async () => {
    const worker = await serviceWorkerOf();
    await worker.install();
    worker.setNetwork(() => basicResponse("server error", { status: 500 }));
    const res = await worker.dispatchFetch("/tasks/42", { mode: "navigate" });
    expect(res?.status).toBe(500);
  });

  test("a navigation while offline answers the cached shell", async () => {
    const worker = await serviceWorkerOf();
    worker.setNetwork(() => basicResponse("SHELL"));
    await worker.install();
    worker.setNetwork(() => {
      throw new TypeError("offline");
    });
    const res = await worker.dispatchFetch("/tasks/42", { mode: "navigate" });
    expect(await res?.text()).toBe("SHELL");
  });

  test("a hashed asset is answered from the cache without the network", async () => {
    const worker = await serviceWorkerOf();
    await worker.install();
    worker.networkRequests.length = 0;
    const res = await worker.dispatchFetch("/assets/client-abc.js");
    expect(await res?.text()).toBe("network:/assets/client-abc.js");
    expect(worker.networkRequests).toEqual([]);
  });

  test("a lazy chunk under /assets is cached on first use", async () => {
    const worker = await serviceWorkerOf();
    await worker.install();
    await worker.dispatchFetch("/assets/chunk-9.js");
    worker.setNetwork(() => {
      throw new TypeError("offline");
    });
    const res = await worker.dispatchFetch("/assets/chunk-9.js");
    expect(await res?.text()).toBe("network:/assets/chunk-9.js");
  });

  test("an unhashed shell file is fetched fresh online and served from the cache offline", async () => {
    const shell = createPwaShell(pwa, { appShellUrls: ["/client.js"], buildToken: "dev" });
    const worker = await serviceWorkerOf(shell);
    await worker.install();
    worker.setNetwork(() => basicResponse("client v2"));
    expect(await (await worker.dispatchFetch("/client.js"))?.text()).toBe("client v2");
    worker.setNetwork(() => {
      throw new TypeError("offline");
    });
    expect(await (await worker.dispatchFetch("/client.js"))?.text()).toBe("client v2");
  });
});
