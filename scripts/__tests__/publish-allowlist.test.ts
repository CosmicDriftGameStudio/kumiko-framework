// publish-with-oidc.sh's package allowlist controls which workspaces actually
// land on npm during a release. The Phase 2 install.sh (https://kumiko.rocks/
// install.sh) runs `bun create kumiko-app`, which resolves to bunx
// create-kumiko-app — an UNSCOPED package whose name forces an exception to
// the @cosmicdrift/* scope check. Without the exception, the release-job
// silently skips it and the one-liner installer 404s.
//
// Tripwire: if a future cleanup tightens the allowlist back to @cosmicdrift/*
// only, this fails before publish.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const SCRIPT = readFileSync(
  fileURLToPath(new URL("../publish-with-oidc.sh", import.meta.url)),
  "utf-8",
);

describe("publish-with-oidc.sh allowlist", () => {
  test("permits the unscoped create-kumiko-app wrapper", () => {
    expect(SCRIPT).toMatch(/case "\$name" in[\s\S]*create-kumiko-app/);
  });

  test("permits the create-kumiko fallback name (Plan-Doc D1)", () => {
    expect(SCRIPT).toMatch(/case "\$name" in[\s\S]*create-kumiko\b/);
  });

  test("still skips foreign scopes by default", () => {
    expect(SCRIPT).toMatch(/foreign scope/);
  });
});
