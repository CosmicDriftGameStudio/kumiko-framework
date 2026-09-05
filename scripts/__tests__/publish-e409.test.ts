import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "bun:test";

// publish-with-oidc.sh's publish_and_tag() must treat npm's E409 "Cannot
// publish over previously staged version" as success: an interrupted earlier
// run already staged that exact version, and the registry finalizes it on its
// own (#2576) — but the version stays unresolvable for a while, so the
// `latest` dist-tag move can still fail right after. That must NOT fail the
// job: it defers to the next run's registry repair. A genuine publish whose
// `latest` move fails, or any other npm publish failure (e.g. E403
// republish-guard), must still fail hard. This drives the real function
// extracted from the script rather than re-implementing or grepping it, so a
// behavioural regression is caught.

const SCRIPT_PATH = fileURLToPath(new URL("../publish-with-oidc.sh", import.meta.url));

function extractPublishAndTag(): string {
  const script = readFileSync(SCRIPT_PATH, "utf-8");
  const match = script.match(/^publish_and_tag\(\)[\s\S]*?^\}/m);
  if (!match) {
    throw new Error(
      "Could not extract publish_and_tag() from publish-with-oidc.sh — did the function get renamed or reshaped?",
    );
  }
  return match[0];
}

const PUBLISH_AND_TAG_FN = extractPublishAndTag();

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "publish-e409-"));
  tempDirs.push(dir);
  return dir;
}

interface NpmStubSpec {
  publishExitCode: number;
  publishOutput: string;
  distTagExitCode: number;
  distTagOutput: string;
}

function runWithNpmStub(spec: NpmStubSpec): { exitCode: number; stderr: string } {
  const dir = makeTempDir();
  const npmStub = join(dir, "npm");
  writeFileSync(
    npmStub,
    [
      "#!/usr/bin/env bash",
      "case \"$1\" in",
      "  publish)",
      `    printf '%b\\n' ${JSON.stringify(spec.publishOutput)} >&2`,
      `    exit ${spec.publishExitCode}`,
      "    ;;",
      "  dist-tag)",
      `    printf '%b\\n' ${JSON.stringify(spec.distTagOutput)} >&2`,
      `    exit ${spec.distTagExitCode}`,
      "    ;;",
      "  *)",
      "    echo \"unexpected npm subcommand: $1\" >&2",
      "    exit 1",
      "    ;;",
      "esac",
    ].join("\n") + "\n",
    { mode: 0o755 },
  );

  const runner = join(dir, "runner.sh");
  writeFileSync(
    runner,
    `#!/usr/bin/env bash\nset -euo pipefail\n\n${PUBLISH_AND_TAG_FN}\n\npublish_and_tag /tmp/fake.tgz @cosmicdrift/kumiko-types 0.233.0\n`,
    { mode: 0o755 },
  );

  const result = Bun.spawnSync(["bash", runner], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  });

  return {
    exitCode: result.exitCode ?? -1,
    stderr: result.stderr.toString("utf-8"),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("publish-with-oidc.sh publish_and_tag()", () => {
  test("succeeds when npm publish and the latest dist-tag move both succeed", () => {
    const { exitCode } = runWithNpmStub({
      publishExitCode: 0,
      publishOutput: "+ @cosmicdrift/kumiko-types@0.233.0",
      distTagExitCode: 0,
      distTagOutput: "+@cosmicdrift/kumiko-types@0.233.0",
    });
    expect(exitCode).toBe(0);
  });

  test("treats E409 'previously staged version' as success even when the immediate latest move 404s (#2576)", () => {
    const { exitCode, stderr } = runWithNpmStub({
      publishExitCode: 1,
      publishOutput:
        "npm error code E409\n" +
        'npm error 409 Conflict - PUT https://registry.npmjs.org/@cosmicdrift%2fkumiko-types - Cannot publish over previously staged version "0.233.0".',
      distTagExitCode: 1,
      distTagOutput: "npm error code E404\nnpm error 404 Not Found - version not found",
    });
    expect(exitCode).toBe(0);
    expect(stderr).toContain("latest move deferred");
  });

  test("fails hard when a genuine publish succeeds but the latest dist-tag move fails", () => {
    const { exitCode } = runWithNpmStub({
      publishExitCode: 0,
      publishOutput: "+ @cosmicdrift/kumiko-types@0.233.0",
      distTagExitCode: 1,
      distTagOutput: "npm error code E404\nnpm error 404 Not Found - version not found",
    });
    expect(exitCode).not.toBe(0);
  });

  test("still fails on a genuine E403 republish-guard error", () => {
    const { exitCode } = runWithNpmStub({
      publishExitCode: 1,
      publishOutput:
        "npm error code E403\n" +
        "npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@cosmicdrift%2fkumiko-types - You cannot publish over the previously published versions",
      distTagExitCode: 0,
      distTagOutput: "",
    });
    expect(exitCode).not.toBe(0);
  });
});
