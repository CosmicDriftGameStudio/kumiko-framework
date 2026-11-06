import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
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
