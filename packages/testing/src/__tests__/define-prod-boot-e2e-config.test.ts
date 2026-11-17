import { describe, expect, test } from "bun:test";
import { PROD_BUNDLES_ENV, SEED_ENABLE_ENV, SEED_TOKEN_ENV } from "../e2e/constants";
import {
  defineProdBootE2eConfig,
  type ProdBootE2eConfigInput,
  prodBootEnvDefaults,
} from "../e2e/define-prod-boot-e2e-config";

function singleWebServer(input: ProdBootE2eConfigInput) {
  const server = defineProdBootE2eConfig(input).webServer;
  if (Array.isArray(server) || server === undefined) throw new Error("expected one webServer");
  return server;
}

describe("defineProdBootE2eConfig defaults", () => {
  test("starts the launcher with the default bundle paths", () => {
    const server = singleWebServer({ port: 4999 });

    expect(server.command).toEndWith(
      "prod-boot-server.ts dist-server/server.js dist-server/kumiko.js",
    );
    expect(server.url).toBe("http://localhost:4999/health");
  });

  test("runs the production boot without seed, demo or bundle env", () => {
    const env = singleWebServer({ port: 4999 }).env ?? {};

    expect(env["NODE_ENV"]).toBe("production");
    expect(env["PORT"]).toBe("4999");
    for (const forbidden of [SEED_ENABLE_ENV, SEED_TOKEN_ENV, PROD_BUNDLES_ENV]) {
      expect(Object.keys(env)).not.toContain(forbidden);
    }
  });

  test("uses one prod-boot project in the default test directory", () => {
    const config = defineProdBootE2eConfig({ port: 4999 });

    expect(config.testDir).toBe("./e2e-prod-boot");
    expect(config.projects?.map((project) => project.name)).toEqual(["prod-boot"]);
  });
});

describe("defineProdBootE2eConfig input", () => {
  test("takes serverEntry, cliEntry and testDir from the input", () => {
    const input = {
      port: 4999,
      serverEntry: "out/server.js",
      cliEntry: "out/cli.js",
      testDir: "./boot-specs",
    };

    expect(singleWebServer(input).command).toEndWith(
      "prod-boot-server.ts out/server.js out/cli.js",
    );
    expect(defineProdBootE2eConfig(input).testDir).toBe("./boot-specs");
  });

  test("app env overrides the throwaway defaults", () => {
    const env = singleWebServer({
      port: 4999,
      env: { PLATFORM_KEK: "app", SMTP_HOST: "mail" },
    }).env;

    expect(env?.["PLATFORM_KEK"]).toBe("app");
    expect(env?.["SMTP_HOST"]).toBe("mail");
  });
});

describe("prodBootEnvDefaults", () => {
  test("generates 32-byte base64 keys", () => {
    const defaults = prodBootEnvDefaults();

    expect(Buffer.from(defaults["PLATFORM_KEK"] ?? "", "base64")).toHaveLength(32);
    expect(Buffer.from(defaults["KUMIKO_BLIND_INDEX_KEY"] ?? "", "base64")).toHaveLength(32);
  });

  test("generates a different KEK per call", () => {
    expect(prodBootEnvDefaults()["PLATFORM_KEK"]).not.toBe(prodBootEnvDefaults()["PLATFORM_KEK"]);
  });
});
