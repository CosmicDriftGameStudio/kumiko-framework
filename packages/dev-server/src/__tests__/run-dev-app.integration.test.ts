// The origin-guard config (allowedOrigins / unsafeSkipOriginCheck) is forwarded
// from runDevApp's auth options through to the server exactly like runProdApp
// (#399/1). The guard fires during server build — AFTER the ephemeral test DB is
// up — so this is an integration test (needs TEST_DATABASE_URL), mirroring the
// run-prod-app forwarding pair. Without it a typo or wrong spread-key on the dev
// path would silently drop the fail-closed guard and dev/prod would diverge.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { KumikoServerHandle } from "../create-kumiko-server";
import { runDevApp } from "../run-dev-app";

function validFeature() {
  return defineFeature("shop", (r) => {
    r.entity("product", createEntity({ fields: { name: createTextField() } }));
  });
}

const ADMIN = {
  email: "origin-guard@example.eu",
  password: "test-pw-strong-1234",
  displayName: "Admin",
  memberships: [],
};

let handle: KumikoServerHandle | undefined;
const savedJwtSecret = process.env["JWT_SECRET"];

beforeEach(() => {
  process.env["JWT_SECRET"] = "test-rundev-secret-32-chars-min!!!!";
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  if (savedJwtSecret === undefined) delete process.env["JWT_SECRET"];
  else process.env["JWT_SECRET"] = savedJwtSecret;
});

describe("runDevApp — auth allowedOrigins forwarding (#399/1)", () => {
  test("cookieDomain without allowedOrigins fails closed — guard is wired through runDevApp", async () => {
    await expect(
      runDevApp({
        features: [validFeature()],
        auth: { admin: ADMIN, cookieDomain: "example.eu" },
      }),
    ).rejects.toThrow(/allowedOrigins is empty/);
  });

  test("cookieDomain + allowedOrigins clears the guard — allowlist reaches the server", async () => {
    // Without the forwarding fix this would ALSO throw /allowedOrigins is empty/.
    handle = await runDevApp({
      features: [validFeature()],
      // Port 0 → OS-assigned ephemeral port, no fixed-port collision in CI.
      port: 0,
      auth: {
        admin: ADMIN,
        cookieDomain: "example.eu",
        allowedOrigins: ["https://app.example.eu"],
      },
    });
    // A booted handle that did not throw on the origin guard IS the forwarding
    // proof — the allowlist reached the server build.
    expect(handle).toBeDefined();
  });

  test("cookieDomain + unsafeSkipOriginCheck clears the guard without an allowlist", async () => {
    // The escape hatch must also forward: cookieDomain alone fails closed
    // (first test), but unsafeSkipOriginCheck=true bypasses it. A dropped/
    // mis-spread key would let the guard fire → /allowedOrigins is empty/.
    handle = await runDevApp({
      features: [validFeature()],
      port: 0,
      auth: {
        admin: ADMIN,
        cookieDomain: "example.eu",
        unsafeSkipOriginCheck: true,
      },
    });
    expect(handle).toBeDefined();
  });
});
