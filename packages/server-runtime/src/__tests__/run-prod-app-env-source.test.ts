// Regression: the boot-path must read the injected `envSource`, not the real
// process.env. Boot-mode (KUMIKO_DRY_RUN_ENV=boot) validates wiring + builds
// the registry, then tears down the lazy DB/Redis clients before any socket
// opens — so this runs without a real Postgres/Redis (same as the CI boot
// smoke). Before the fix, requireEnv/readEnv read process.env directly, so the
// required-var test would throw "required env var DATABASE_URL is missing" and
// the PORT test would bind the default instead of the injected port.

import { describe, expect, test } from "bun:test";
import { runProdApp } from "../run-prod-app";
import { makeProbeFeature, withClearedBootEnv } from "./boot-probe-fixture";

const probeFeature = makeProbeFeature({
  name: "env-source-probe",
  table: "env_source_probe",
});

const DUMMY_ENV = {
  KUMIKO_DRY_RUN_ENV: "boot",
  DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:1/smoke",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "smokesmokesmokesmokesmokesmokesmokesmoke",
} as const;

describe("runProdApp boot-mode env-source", () => {
  withClearedBootEnv();

  test("boots from injected envSource even when process.env lacks the required vars", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    let handle: Awaited<ReturnType<typeof runProdApp>>;
    try {
      handle = await runProdApp({
        features: [probeFeature],
        autoListen: false,
        migrations: false,
        // REDIS_URL points at an unreachable port — boot-mode must NOT
        // construct the (eager) Redis client, so this never tries to connect.
        envSource: { ...DUMMY_ENV },
      });
    } finally {
      console.log = originalLog;
    }

    // Boot-mode with an injected envSource returns an inert dry-run handle.
    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe("function");
    // The registry was built + validated before any connection was opened.
    expect(logs.some((line) => line.includes("boot validation OK"))).toBe(true);
    await handle.stop();
  });

  test("boot-mode constructs no eager Redis client — kein TCP-Connect auf REDIS_URL", async () => {
    // Kern-Garantie (224/2), als Netzwerk-Beweis statt Konstruktor-Spy:
    // REDIS_URL zeigt auf einen lokalen Listener — `new Redis(...)`
    // connectet eager, der Boot-Exit MUSS also vorher liegen, sonst
    // zählt der Listener eine Connection.
    let connections = 0;
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          connections += 1;
          socket.end();
        },
        data() {},
      },
    });

    const originalLog = console.log;
    console.log = () => {};
    try {
      const handle = await runProdApp({
        features: [probeFeature],
        autoListen: false,
        migrations: false,
        envSource: { ...DUMMY_ENV, REDIS_URL: `redis://127.0.0.1:${listener.port}` },
      });
      await handle.stop();
    } finally {
      console.log = originalLog;
    }

    // Ein eager Connect wäre bereits beim runProdApp-await passiert;
    // kleine Nachfrist für asynchrone Socket-Anläufe.
    await new Promise((resolve) => setTimeout(resolve, 150));
    listener.stop(true);
    expect(connections).toBe(0);
  });

  test("resolves PORT from envSource, not process.env", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const handle = await runProdApp({
        features: [probeFeature],
        autoListen: false,
        migrations: false,
        envSource: { ...DUMMY_ENV, PORT: "8123" },
      });
      await handle.stop();
    } finally {
      console.log = originalLog;
    }

    // The boot logs "booting Kumiko stack on port <port>" — pre-fix this read
    // process.env["PORT"] (deleted here) and would log the 3000 default.
    expect(logs.some((line) => line.includes("port 8123"))).toBe(true);
    expect(logs.some((line) => line.includes("port 3000"))).toBe(false);
  });
});
