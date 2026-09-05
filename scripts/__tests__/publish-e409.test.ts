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
// job: it defers to the next run's registry repair.
//
// It must also treat npm's E403 "cannot publish over the previously published
// versions" as success, but ONLY when the rejected version is the exact one
// being published: registry replication lag (#2586) can leave the earlier
// exact-version lookup blind to a publish that just landed elsewhere, so this
// rescue run redundantly retries `npm publish` for a version that is already
// live. An E403 naming a *different* version, or any other npm publish
// failure (auth, network, tarball, a failing `latest` move), must still fail
// hard. This drives the real function extracted from the script rather than
// re-implementing or grepping it, so a behavioural regression is caught.

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

function extractPublishOutcomeBranch(): string {
  const script = readFileSync(SCRIPT_PATH, "utf-8");
  const match = script.match(
    /elif publish_and_tag "\$pkg_dir\/\$TARBALL" "\$name" "\$version"; then\n([\s\S]*?)\n {2}else\n {4}failed\+=\("\$name@\$version"\)\n {2}fi/,
  );
  if (!match) {
    throw new Error(
      "Could not extract the publish_and_tag() outcome branch from publish-with-oidc.sh — did the call site get reshaped?",
    );
  }
  return match[1];
}

const PUBLISH_OUTCOME_BRANCH = extractPublishOutcomeBranch();

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

function runWithNpmStub(spec: NpmStubSpec): { exitCode: number; stdout: string; stderr: string } {
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
    `#!/usr/bin/env bash\nset -euo pipefail\n\n${PUBLISH_AND_TAG_FN}\n\n` +
      `publish_and_tag /tmp/fake.tgz @cosmicdrift/kumiko-types 0.233.0\n` +
      `echo "already_published_via_e403=$already_published_via_e403"\n`,
    { mode: 0o755 },
  );

  const result = Bun.spawnSync(["bash", runner], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  });

  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString("utf-8"),
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

  test("treats E403 'previously published versions' for the exact target version as already released (#2586)", () => {
    const { exitCode, stdout } = runWithNpmStub({
      publishExitCode: 1,
      publishOutput:
        "npm error code E403\n" +
        "npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@cosmicdrift%2fkumiko-types - You cannot publish over the previously published versions: 0.233.0.",
      // Would fail the run if publish_and_tag reached it — proves the
      // already-published path returns before ever touching the dist-tag.
      distTagExitCode: 1,
      distTagOutput: "npm error code E404\nnpm error 404 Not Found - version not found",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("already_published_via_e403=1");
  });

  test("still fails when the E403 names a different version than the one being published", () => {
    const { exitCode, stdout } = runWithNpmStub({
      publishExitCode: 1,
      publishOutput:
        "npm error code E403\n" +
        "npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@cosmicdrift%2fkumiko-types - You cannot publish over the previously published versions: 0.999.0.",
      distTagExitCode: 0,
      distTagOutput: "",
    });
    expect(exitCode).not.toBe(0);
    expect(stdout).not.toContain("already_published_via_e403=1");
  });
});

// The per-package outcome branch in the main loop (guarded by
// $already_published_via_e403, set by publish_and_tag() above) is what
// actually decides "published" vs "skipped" for the release-job summary line
// and whether a "New tag:" marker reaches changesets/action. Driving the
// literal extracted branch — rather than re-deriving its behaviour — proves
// the E403-detected case increments `skipped`, not `published`, and never
// emits "New tag:".
function runPublishOutcomeBranch(alreadyPublishedViaE403: boolean): {
  exitCode: number;
  stdout: string;
} {
  const dir = makeTempDir();
  for (const [bin, body] of [
    ["npm", "#!/usr/bin/env bash\nexit 0\n"],
    ["git", "#!/usr/bin/env bash\nexit 0\n"],
  ] as const) {
    writeFileSync(join(dir, bin), body, { mode: 0o755 });
  }

  const runner = join(dir, "runner.sh");
  writeFileSync(
    runner,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'name="@cosmicdrift/kumiko-types"',
      'version="0.233.0"',
      "published=0",
      "skipped=0",
      "failed=()",
      'published_json="[]"',
      `already_published_via_e403=${alreadyPublishedViaE403 ? 1 : 0}`,
      "if true; then",
      PUBLISH_OUTCOME_BRANCH,
      "else",
      '  failed+=("$name@$version")',
      "fi",
      'echo "published=$published"',
      'echo "skipped=$skipped"',
    ].join("\n") + "\n",
    { mode: 0o755 },
  );

  const result = Bun.spawnSync(["bash", runner], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  });

  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString("utf-8"),
  };
}

describe("publish-with-oidc.sh per-package outcome branch", () => {
  test("counts the E403-detected already-published case as skipped and emits no New tag", () => {
    const { exitCode, stdout } = runPublishOutcomeBranch(true);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("published=0");
    expect(stdout).toContain("skipped=1");
    expect(stdout).not.toContain("New tag:");
  });

  test("counts a genuine publish as published and emits New tag", () => {
    const { exitCode, stdout } = runPublishOutcomeBranch(false);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("published=1");
    expect(stdout).toContain("skipped=0");
    expect(stdout).toContain("New tag: @cosmicdrift/kumiko-types@0.233.0");
  });
});
