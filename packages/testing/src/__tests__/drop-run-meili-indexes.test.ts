import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEILI_INDEX_PREFIX_ENV } from "../e2e/constants";
import dropRunMeiliIndexes from "../e2e/drop-run-meili-indexes";

function runConfig(meiliUrl: string, apiKey: string) {
  return {
    webServer: {
      command: "unused",
      env: {
        [MEILI_INDEX_PREFIX_ENV]: "test_e2e_",
        MEILI_URL: meiliUrl,
        MEILI_MASTER_KEY: apiKey,
      },
    },
  };
}

describe("dropRunMeiliIndexes failure paths", () => {
  let stderr: Mock<typeof process.stderr.write>;

  function reportedOutput(): string {
    return stderr.mock.calls.map((call) => String(call[0])).join("");
  }

  beforeEach(() => {
    stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  test("an app without Meilisearch finishes silently", async () => {
    await dropRunMeiliIndexes(runConfig("http://127.0.0.1:9", "unused"));

    expect(stderr).not.toHaveBeenCalled();
  });

  test("a config without a server has nothing to drop", async () => {
    await dropRunMeiliIndexes({ webServer: null });

    expect(stderr).not.toHaveBeenCalled();
  });

  test("a rejected key reports the failure and does not fail the finished run", async () => {
    const rejectingMeili = Bun.serve({
      port: 0,
      fetch: (req) =>
        new URL(req.url).pathname === "/health"
          ? new Response("{}")
          : new Response("{}", { status: 403 }),
    });
    try {
      await dropRunMeiliIndexes(runConfig(`http://127.0.0.1:${rejectingMeili.port}`, "wrong-key"));

      expect(reportedOutput()).toContain("not dropped");
      expect(reportedOutput()).toContain("403");
    } finally {
      await rejectingMeili.stop(true);
    }
  });

  test("URL and key from the app's .env reach the teardown when the shell sets none", async () => {
    const seenAuthorization: (string | null)[] = [];
    const meili = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/health") return new Response("{}");
        seenAuthorization.push(req.headers.get("authorization"));
        return Response.json({ results: [], total: 0 });
      },
    });
    const originalCwd = process.cwd();
    const appDir = mkdtempSync(join(tmpdir(), "drop-meili-dotenv-"));
    writeFileSync(
      join(appDir, ".env"),
      `MEILI_URL=http://127.0.0.1:${meili.port}\nMEILI_MASTER_KEY=dotenv-key\n`,
    );
    try {
      process.chdir(appDir);
      await dropRunMeiliIndexes({
        webServer: { command: "unused", env: { [MEILI_INDEX_PREFIX_ENV]: "test_e2e_" } },
      });

      expect(seenAuthorization).toEqual(["Bearer dotenv-key"]);
    } finally {
      process.chdir(originalCwd);
      rmSync(appDir, { recursive: true, force: true });
      await meili.stop(true);
    }
  });

  test("a connection lost after the health check reports without the key", async () => {
    const apiKey = `sentinel-${crypto.randomUUID()}`;
    const flakyMeili = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (new URL(req.url).pathname === "/health") return new Response("{}");
        server.stop(true);
        return new Response(null, { status: 500 });
      },
    });
    try {
      await dropRunMeiliIndexes(runConfig(`http://127.0.0.1:${flakyMeili.port}`, apiKey));

      expect(reportedOutput()).toContain("not dropped");
      expect(reportedOutput()).not.toContain(apiKey);
    } finally {
      await flakyMeili.stop(true);
    }
  });
});

describe("dropRunMeiliIndexes sweep of earlier e2e runs", () => {
  const NOW = new Date("2026-11-18T12:00:00.000Z");
  const HOUR_MS = 60 * 60 * 1000;
  const RUN_PREFIX = "e2e_current-run_";
  let stderr: Mock<typeof process.stderr.write>;

  function hoursAgo(hours: number): string {
    return new Date(NOW.getTime() - hours * HOUR_MS).toISOString();
  }

  type FakeIndex = { readonly uid: string; readonly createdAt: string };

  // Answers the index listing page by page like Meilisearch and records every delete.
  function fakeMeili(indexes: readonly FakeIndex[], failingDeletes: readonly string[] = []) {
    const deleted: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health") return new Response("{}");
        if (req.method === "GET" && url.pathname === "/indexes") {
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? 20);
          return Response.json({
            results: indexes.slice(offset, offset + limit),
            offset,
            limit,
            total: indexes.length,
          });
        }
        const uid = decodeURIComponent(url.pathname.replace("/indexes/", ""));
        if (req.method === "DELETE" && failingDeletes.includes(uid)) {
          return new Response("{}", { status: 500 });
        }
        if (req.method === "DELETE") {
          deleted.push(uid);
          return Response.json({ taskUid: deleted.length }, { status: 202 });
        }
        return new Response("{}", { status: 404 });
      },
    });
    return { server, deleted };
  }

  function sweepConfig(server: { readonly url: URL }) {
    return {
      webServer: {
        command: "unused",
        env: {
          [MEILI_INDEX_PREFIX_ENV]: RUN_PREFIX,
          MEILI_URL: server.url.origin,
          MEILI_MASTER_KEY: "unused",
        },
      },
    };
  }

  const firstPageFiller: FakeIndex[] = Array.from({ length: 199 }, (_, index) => ({
    uid: `products_${index}`,
    createdAt: hoursAgo(48),
  }));

  beforeEach(() => {
    setSystemTime(NOW);
    stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    setSystemTime();
    stderr.mockRestore();
  });

  test("drops this run and e2e indexes older than a day, on every page, and keeps the rest", async () => {
    const meili = fakeMeili([
      ...firstPageFiller,
      { uid: `${RUN_PREFIX}tasks`, createdAt: hoursAgo(0) },
      { uid: "e2e_killed-run_tasks", createdAt: hoursAgo(25) },
      { uid: "e2e_parallel-run_tasks", createdAt: hoursAgo(1) },
      { uid: "orders_tasks", createdAt: hoursAgo(72) },
      { uid: `${RUN_PREFIX}notes`, createdAt: hoursAgo(0) },
    ]);
    try {
      await dropRunMeiliIndexes(sweepConfig(meili.server));

      expect(meili.deleted.toSorted()).toEqual([
        "e2e_current-run_notes",
        "e2e_current-run_tasks",
        "e2e_killed-run_tasks",
      ]);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      await meili.server.stop(true);
    }
  });

  test("a failed delete of an old index is reported and does not keep this run's indexes", async () => {
    const meili = fakeMeili(
      [
        { uid: "e2e_killed-run_tasks", createdAt: hoursAgo(30) },
        { uid: `${RUN_PREFIX}tasks`, createdAt: hoursAgo(0) },
      ],
      ["e2e_killed-run_tasks"],
    );
    try {
      await dropRunMeiliIndexes(sweepConfig(meili.server));

      expect(meili.deleted).toEqual(["e2e_current-run_tasks"]);
      const output = stderr.mock.calls.map((call) => String(call[0])).join("");
      expect(output).toContain("1 stale Meilisearch indexes of earlier e2e runs not dropped");
      expect(output).toContain("deleting e2e_killed-run_tasks answered 500");
      expect(output).not.toContain("of this run not dropped");
    } finally {
      await meili.server.stop(true);
    }
  });
});
