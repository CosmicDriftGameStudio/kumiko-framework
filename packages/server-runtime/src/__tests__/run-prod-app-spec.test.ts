// These spec tests pin the intent and acceptable ranges for Bun.serve options and heartbeat cadence.
// The constants and defaults have caused live bugs, so the expectations should remain easy to revert
// deliberately rather than being weakened by "looks like a leak" or "a small increase should be enough"
// tweaks.

import { describe, expect, test } from "bun:test";
import {
  type KumikoServeEnv,
  type KumikoWebSocketData,
  SSE_HEARTBEAT_INTERVAL_MS,
  WEBSOCKET_BACKPRESSURE_LIMIT_BYTES,
  WEBSOCKET_HEARTBEAT_INTERVAL_MS,
  WEBSOCKET_MAX_PAYLOAD_BYTES,
} from "@cosmicdrift/kumiko-framework/api";
import {
  createEntity,
  createFileField,
  createRegistry,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFilesFeature, resolveMaxUploadBodyBytes } from "@cosmicdrift/kumiko-framework/files";
import {
  DEFAULT_MAX_REQUEST_BODY_SIZE_BYTES,
  resolveDerivedMaxRequestBodySize,
} from "../bun-serve-options.ts";
import { buildBunServeOptions } from "../run-prod-app.ts";

describe("Bun.serve options for production", () => {
  test("idleTimeout is 0 (disabled) — required for SSE long-lived connections", () => {
    // Bun.serve defaults to 10s; without this override, SSE streams are terminated with a partial
    // HTTP/2-RST_STREAM. The contract is "disabled": any other value can break SSE when a client
    // backgrounds the tab and the browser stops reading heartbeats, allowing the idle timer to fire.
    const opts = buildBunServeOptions(0, () => new Response("ok"));
    expect(opts.idleTimeout).toBe(0);
  });

  test("websocket payload cap is 1 MiB and the ping cadence stays under nginx's 60 s", () => {
    // ingress-nginx's default proxy-read-timeout is 60 s: a quiet socket needs a server ping below it.
    const opts = buildBunServeOptions(0, () => new Response("ok"));
    expect(opts.websocket.maxPayloadLength).toBe(1024 * 1024);
    expect(WEBSOCKET_MAX_PAYLOAD_BYTES).toBe(1024 * 1024);
    expect(WEBSOCKET_HEARTBEAT_INTERVAL_MS).toBeLessThan(60_000);
  });

  test("a stalled reader is cut off: 4 MiB backpressure limit, close on limit", () => {
    const opts = buildBunServeOptions(0, () => new Response("ok"));
    expect(opts.websocket.backpressureLimit).toBe(4 * 1024 * 1024);
    expect(WEBSOCKET_BACKPRESSURE_LIMIT_BYTES).toBe(4 * 1024 * 1024);
    expect(opts.websocket.closeOnBackpressureLimit).toBe(true);
  });

  test("upgrade requests go to webSocketUpgradeFetch with the server handle, others to fetchHandler", async () => {
    const plain: string[] = [];
    const upgraded: KumikoServeEnv[] = [];
    const opts = buildBunServeOptions(
      0,
      (_req, socketAddress) => {
        plain.push(socketAddress ?? "none");
        return new Response("plain");
      },
      undefined,
      {
        upgradeFetch: (_req, serveEnv) => {
          upgraded.push(serveEnv);
          return new Response("upgrade");
        },
      },
    );
    const fakeServer = { requestIP: () => ({ address: "203.0.113.9", port: 1, family: "IPv4" }) };
    const server = fakeServer as unknown as Bun.Server<KumikoWebSocketData>;
    await opts.fetch(new Request("http://localhost/api/x"), server);
    await opts.fetch(
      new Request("http://localhost/api/ws/x", { headers: { Upgrade: "WebSocket" } }),
      server,
    );
    // An upgrade outside /api/ws/ (dev HMR etc.) stays on the normal fetch path.
    await opts.fetch(
      new Request("http://localhost/__hmr", { headers: { Upgrade: "websocket" } }),
      server,
    );
    expect(plain).toEqual(["203.0.113.9", "203.0.113.9"]);
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]?.socketAddress).toBe("203.0.113.9");
    expect(upgraded[0]?.server).toBe(server);
  });

  test("port is passed through 1:1, fetch passes req + socket address to the handler", async () => {
    let received: [Request, string | undefined] | undefined;
    const fetchHandler = (req: Request, socketAddress?: string) => {
      received = [req, socketAddress];
      return new Response("test");
    };
    const opts = buildBunServeOptions(3000, fetchHandler);
    expect(opts.port).toBe(3000);
    const req = new Request("http://localhost/");
    const fakeServer = { requestIP: () => ({ address: "203.0.113.1", port: 1, family: "IPv4" }) };
    await opts.fetch(req, fakeServer as unknown as Bun.Server<unknown>);
    expect(received?.[0]).toBe(req);
    expect(received?.[1]).toBe("203.0.113.1");
  });

  test("maxRequestBodySize defaults well below Bun's own 128 MiB", () => {
    // Bun.serve's undocumented-in-our-code default (128 MiB) buffers every
    // concurrent request up to that size before any app-level body-limit
    // middleware runs. Pins the lowered default against a silent revert to
    // "just let Bun handle it".
    const opts = buildBunServeOptions(0, () => new Response("ok"));
    expect(opts.maxRequestBodySize).toBe(DEFAULT_MAX_REQUEST_BODY_SIZE_BYTES);
    expect(opts.maxRequestBodySize).toBeLessThan(128 * 1024 * 1024);
  });

  test("maxRequestBodySize is overridable for apps with larger maxUploadSize", () => {
    const opts = buildBunServeOptions(0, () => new Response("ok"), 64 * 1024 * 1024);
    expect(opts.maxRequestBodySize).toBe(64 * 1024 * 1024);
  });
});

describe("resolveDerivedMaxRequestBodySize", () => {
  test("stays above the files route's own derived bodyLimit", () => {
    // Otherwise Bun's bare rejection would fire before the route's own,
    // more specific 413 ever runs.
    const registry = createRegistry([createFilesFeature({ maxUploadSize: "50mb" })]);
    const routeBodyLimit = resolveMaxUploadBodyBytes({ registry, maxUploadSize: "50mb" });
    expect(resolveDerivedMaxRequestBodySize(registry)).toBeGreaterThan(routeBodyLimit);
  });

  test("accounts for a field maxSize configured above the global default", () => {
    const entity = createEntity({
      fields: { attachment: createFileField({ maxSize: "50mb" }) },
    });
    const feature = defineFeature("attachments", (r) =>
      r.entity({ name: "attachment", ...entity }),
    );
    const registry = createRegistry([feature, createFilesFeature()]);
    expect(resolveDerivedMaxRequestBodySize(registry)).toBeGreaterThanOrEqual(50 * 1024 * 1024);
  });
});

describe("SSE heartbeat cadence", () => {
  test("liegt unter dem strengsten Edge-Idle-Timeout (Cloudflare 100s)", () => {
    // Bun.serve's idleTimeout is disabled (see buildBunServeOptions), so the Bun 10s default
    // does not apply. The remaining strictest layers are CDN/LB edges:
    //   - Cloudflare Edge: 100 s (strictest realistic layer)
    //   - AWS ALB: 60 s
    //   - Nginx default: keep-alive 60 s, but not for streams
    // The heartbeat must stay well below these limits so a delayed frame does not kill the connection;
    // a factor of five provides conservative headroom.
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBeLessThan(60_000);
  });

  test("is not too high — defense in depth against Bun's default drift", () => {
    // If idleTimeout: 0 is removed, the heartbeat must not be the only protection below Bun's 10s
    // default. A limit of 30s provides some cushion while remaining well below three times that
    // default.
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(30_000);
  });

  test("is >= 5 s — frequency wall against accidental network spam", () => {
    // 1000 anonymous viewers sending heartbeats must not flood the server with frames. At 5s,
    // 1000 clients produce 200 frames/s, which is acceptable; below 5s is more likely a typo
    // than an intentional choice.
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(5_000);
  });
});
