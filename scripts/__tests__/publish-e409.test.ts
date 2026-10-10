import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

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
// live. Detection must key off that message line alone, not a companion `npm
// error code E403` line — the 0.238.0 release hit this rescue case with npm
// printing only the message, and a code-gated check missed it, hard-failing a
// release that had actually landed. An E403 naming a *different* version, or
// any other npm publish failure (auth, network, tarball, a failing `latest`
// move), must still fail hard. This drives the real function extracted from
// the script rather than re-implementing or grepping it, so a behavioural
// regression is caught.

const SCRIPT_PATH = fileURLToPath(new URL("../publish-with-oidc.sh", import.meta.url));

function extractPublishAndTag(): string {
  const script = readFileSync(SCRIPT_PATH, "utf-8");
  const match = script.match(/^publish_and_tag\(\)[\s\S]*?^\}/m);
  if (!match) {
    throw new Error(
      "Could not extract publish_and_tag() from publish-with-oidc.sh — did the function get renamed or reshaped?",
    );
  }
  assertParsesAsBash(match[0], "publish_and_tag()");
  return match[0];
}

// A column-0 `}` inside the function (heredoc terminator, reformatted `case`)
// would end the lazy match early and hand the runner half a function.
function assertParsesAsBash(snippet: string, label: string): void {
  const syntax = Bun.spawnSync(["bash", "-n"], { stdin: new TextEncoder().encode(snippet) });
  if (syntax.exitCode !== 0) {
    throw new Error(
      `Extracted ${label} from publish-with-oidc.sh is not valid bash (${syntax.stderr.toString("utf-8").trim()}) — the extraction regex probably cut the function short.`,
    );
  }
}

const PUBLISH_AND_TAG_FN = extractPublishAndTag();

function extractTopLevelFn(fnName: string): string {
  const script = readFileSync(SCRIPT_PATH, "utf-8");
  const match = script.match(new RegExp(`^${fnName}\\(\\)[\\s\\S]*?^\\}`, "m"));
  if (!match) {
    throw new Error(`Could not extract ${fnName}() from publish-with-oidc.sh`);
  }
  assertParsesAsBash(match[0], `${fnName}()`);
  return match[0];
}

const EMIT_TAG_FN = extractTopLevelFn("emit_tag_unless_on_origin");
const REMOVE_TMP_TAG_FN = extractTopLevelFn("remove_tmp_tag");

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

// macOS scans every freshly written executable on its first exec (~300 ms, far
// more under load). Writing new stubs per test blew the 5 s unit budget, so the
// stubs are written once and steered per test through env vars.
const NPM_STUB = [
  "#!/usr/bin/env bash",
  '[ -n "${STUB_CALL_LOG:-}" ] && echo "$*" >> "$STUB_CALL_LOG"',
  'case "$1 $2" in',
  '  "dist-tag ls") printf \'%b\' "${STUB_DIST_TAG_LS:-}"; exit 0 ;;',
  "esac",
  'case "$1" in',
  "  publish)",
  "    printf '%b\\n' \"${STUB_PUBLISH_OUTPUT:-}\" >&2",
  '    exit "${STUB_PUBLISH_EXIT:-0}"',
  "    ;;",
  "  dist-tag)",
  "    printf '%b\\n' \"${STUB_DIST_TAG_OUTPUT:-}\" >&2",
  '    exit "${STUB_DIST_TAG_EXIT:-0}"',
  "    ;;",
  "  *)",
  '    echo "unexpected npm subcommand: $1" >&2',
  "    exit 1",
  "    ;;",
  "esac",
].join("\n") + "\n";

// `ls-remote` answers with a ref line only when the tag is already on origin.
const GIT_STUB = [
  "#!/usr/bin/env bash",
  'if [ "$1" = "ls-remote" ] && [ "${STUB_REMOTE_HAS_TAG:-0}" = "1" ]; then',
  '  echo "abc123\trefs/tags/$4"',
  "fi",
  "exit 0",
].join("\n") + "\n";

let stubDir = "";

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), "publish-e409-"));
  writeFileSync(join(stubDir, "npm"), NPM_STUB, { mode: 0o755 });
  writeFileSync(join(stubDir, "git"), GIT_STUB, { mode: 0o755 });
});

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

function runBash(
  script: string,
  stubEnv: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  // Passed via env, not interpolated into the stub: npm output containing `$`
  // or backticks must reach the script verbatim.
  const result = Bun.spawnSync(["bash", "-c", script], {
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}`, ...stubEnv },
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString("utf-8"),
    stderr: result.stderr.toString("utf-8"),
  };
}

interface NpmStubSpec {
  publishExitCode: number;
  publishOutput: string;
  distTagExitCode: number;
  distTagOutput: string;
}

function runWithNpmStub(spec: NpmStubSpec): { exitCode: number; stdout: string; stderr: string } {
  const script =
    `set -euo pipefail\n\n${PUBLISH_AND_TAG_FN}\n\n` +
    `publish_and_tag /tmp/fake.tgz @cosmicdrift/kumiko-types 0.233.0\n` +
    `echo "already_published_via_e403=$already_published_via_e403"\n` +
    `echo "staged_unconfirmed=$staged_unconfirmed"\n`;
  return runBash(script, {
    STUB_PUBLISH_OUTPUT: spec.publishOutput,
    STUB_PUBLISH_EXIT: String(spec.publishExitCode),
    STUB_DIST_TAG_OUTPUT: spec.distTagOutput,
    STUB_DIST_TAG_EXIT: String(spec.distTagExitCode),
    STAGED_POLL_ATTEMPTS: "2",
    STAGED_POLL_INTERVAL_SECONDS: "0",
  });
}

describe("publish-with-oidc.sh publish_and_tag()", () => {
  test("succeeds when npm publish and the latest dist-tag move both succeed", () => {
    const { exitCode, stderr } = runWithNpmStub({
      publishExitCode: 0,
      publishOutput: "+ @cosmicdrift/kumiko-types@0.233.0",
      distTagExitCode: 0,
      distTagOutput: "+@cosmicdrift/kumiko-types@0.233.0",
    });
    expect(exitCode).toBe(0);
    expect(stderr).toContain("+ @cosmicdrift/kumiko-types@0.233.0");
  });

  test("treats E409 'previously staged version' as unconfirmed success when latest never resolves (#2576)", () => {
    const { exitCode, stdout, stderr } = runWithNpmStub({
      publishExitCode: 1,
      publishOutput:
        "npm error code E409\n" +
        'npm error 409 Conflict - PUT https://registry.npmjs.org/@cosmicdrift%2fkumiko-types - Cannot publish over previously staged version "0.233.0".',
      distTagExitCode: 1,
      distTagOutput: "npm error code E404\nnpm error 404 Not Found - version not found",
    });
    expect(exitCode).toBe(0);
    expect(stderr).toContain("retrying latest move (2/2)");
    expect(stderr).toContain("::warning::");
    expect(stdout).toContain("staged_unconfirmed=1");
  });

  test("E409 staged version resolving during the poll window moves latest and counts as confirmed", () => {
    const { exitCode, stdout } = runWithNpmStub({
      publishExitCode: 1,
      publishOutput:
        "npm error code E409\n" +
        'npm error 409 Conflict - PUT https://registry.npmjs.org/@cosmicdrift%2fkumiko-types - Cannot publish over previously staged version "0.233.0".',
      distTagExitCode: 0,
      distTagOutput: "+@cosmicdrift/kumiko-types@0.233.0",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("staged_unconfirmed=0");
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

  test("treats the E403 message alone as already released even without a 'code E403' line (0.238.0 regression)", () => {
    const { exitCode, stdout } = runWithNpmStub({
      publishExitCode: 1,
      publishOutput:
        "npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@cosmicdrift%2fkumiko-types - You cannot publish over the previously published versions: 0.233.0.",
      // Would fail the run if publish_and_tag reached it — proves the
      // already-published path returns before ever touching the dist-tag.
      distTagExitCode: 1,
      distTagOutput: "npm error code E404\nnpm error 404 Not Found - version not found",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("already_published_via_e403=1");
  });

  test("still fails hard on an unrelated npm error such as E401 auth failure", () => {
    const { exitCode, stdout } = runWithNpmStub({
      publishExitCode: 1,
      publishOutput:
        "npm error code E401\n" +
        "npm error 401 Unauthorized - PUT https://registry.npmjs.org/@cosmicdrift%2fkumiko-types - You must be logged in to publish packages.",
      distTagExitCode: 0,
      distTagOutput: "",
    });
    expect(exitCode).not.toBe(0);
    expect(stdout).not.toContain("already_published_via_e403=1");
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
function runPublishOutcomeBranch(
  unconfirmed: "none" | "e403" | "staged",
  remoteHasTag = false,
): {
  exitCode: number;
  stdout: string;
} {
  const script =
    [
      "set -euo pipefail",
      EMIT_TAG_FN,
      REMOVE_TMP_TAG_FN,
      'name="@cosmicdrift/kumiko-types"',
      'version="0.233.0"',
      "published=0",
      "skipped=0",
      "failed=()",
      'published_json="[]"',
      `already_published_via_e403=${unconfirmed === "e403" ? 1 : 0}`,
      `staged_unconfirmed=${unconfirmed === "staged" ? 1 : 0}`,
      "if true; then",
      PUBLISH_OUTCOME_BRANCH,
      "else",
      '  failed+=("$name@$version")',
      "fi",
      'echo "published=$published"',
      'echo "skipped=$skipped"',
    ].join("\n") + "\n";
  const { exitCode, stdout } = runBash(script, { STUB_REMOTE_HAS_TAG: remoteHasTag ? "1" : "0" });
  return { exitCode, stdout };
}

function extractAlreadyOnRegistryBranch(): string {
  const script = readFileSync(SCRIPT_PATH, "utf-8");
  const match = script.match(
    /if \[ "\$version" = "\$exact_version" \]; then\n([\s\S]*?\n {4}continue)\n {2}fi/,
  );
  if (!match) {
    throw new Error(
      "Could not extract the already-on-registry skip branch from publish-with-oidc.sh — did the call site get reshaped?",
    );
  }
  return match[1];
}

const ALREADY_ON_REGISTRY_BRANCH = extractAlreadyOnRegistryBranch();

function runSkipBranch(
  distTagLs: string,
  remoteHasTag = true,
  distTagExitCode = 0,
): { exitCode: number; stdout: string; npmCalls: string[] } {
  const callLog = join(stubDir, "npm-calls.log");
  rmSync(callLog, { force: true });
  const script =
    [
      "set -euo pipefail",
      EMIT_TAG_FN,
      REMOVE_TMP_TAG_FN,
      'name="@cosmicdrift/kumiko-types"',
      'version="0.233.0"',
      'registry_version="0.233.0"',
      'exact_version="0.233.0"',
      "skipped=0",
      "for _ in 1; do",
      "if true; then",
      ALREADY_ON_REGISTRY_BRANCH,
      "fi",
      "done",
      'echo "skipped=$skipped"',
    ].join("\n") + "\n";
  // The extracted branch ends at `continue`; the closing `fi` is re-added above.
  const { exitCode, stdout } = runBash(script, {
    STUB_CALL_LOG: callLog,
    STUB_DIST_TAG_LS: distTagLs,
    STUB_REMOTE_HAS_TAG: remoteHasTag ? "1" : "0",
    STUB_DIST_TAG_EXIT: String(distTagExitCode),
  });
  const calls = existsSync(callLog) ? readFileSync(callLog, "utf-8").trim().split("\n") : [];
  return { exitCode, stdout, npmCalls: calls };
}

describe("publish-with-oidc.sh already-on-registry skip branch", () => {
  test("removes the kumiko-tmp tag only when it exists", () => {
    const withTag = runSkipBranch("latest: 0.233.0\\nkumiko-tmp: 0.233.0\\n");
    expect(withTag.exitCode).toBe(0);
    expect(withTag.npmCalls).toContain("dist-tag rm @cosmicdrift/kumiko-types kumiko-tmp");

    const withoutTag = runSkipBranch("latest: 0.233.0\\n");
    expect(withoutTag.exitCode).toBe(0);
    expect(withoutTag.npmCalls).not.toContain("dist-tag rm @cosmicdrift/kumiko-types kumiko-tmp");
  });

  test("a rejected kumiko-tmp removal does not fail the run", () => {
    const { exitCode, stdout } = runSkipBranch("latest: 0.233.0\\nkumiko-tmp: 0.233.0\\n", false, 1);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("skipped=1");
    expect(stdout).toContain("New tag: @cosmicdrift/kumiko-types@0.233.0");
  });

  test("emits New tag for a registry version whose tag is missing on origin", () => {
    expect(runSkipBranch("latest: 0.233.0\\n", false).stdout).toContain(
      "New tag: @cosmicdrift/kumiko-types@0.233.0",
    );
    expect(runSkipBranch("latest: 0.233.0\\n", true).stdout).not.toContain("New tag:");
  });
});

describe("publish-with-oidc.sh per-package outcome branch", () => {
  test("counts the E403-detected already-published case as skipped and tags it when origin has no tag", () => {
    const { exitCode, stdout } = runPublishOutcomeBranch("e403");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("published=0");
    expect(stdout).toContain("skipped=1");
    expect(stdout).toContain("New tag: @cosmicdrift/kumiko-types@0.233.0");
  });

  test("emits no New tag for an E403-detected version whose tag already exists on origin", () => {
    const { stdout } = runPublishOutcomeBranch("e403", true);
    expect(stdout).toContain("skipped=1");
    expect(stdout).not.toContain("New tag:");
  });

  test("counts a staged-but-unconfirmed version as skipped and tags it when origin has no tag (#2578)", () => {
    const { exitCode, stdout } = runPublishOutcomeBranch("staged");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("published=0");
    expect(stdout).toContain("skipped=1");
    expect(stdout).toContain("New tag: @cosmicdrift/kumiko-types@0.233.0");
  });

  test("counts a genuine publish as published and emits New tag", () => {
    const { exitCode, stdout } = runPublishOutcomeBranch("none");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("published=1");
    expect(stdout).toContain("skipped=0");
    expect(stdout).toContain("New tag: @cosmicdrift/kumiko-types@0.233.0");
  });
});
