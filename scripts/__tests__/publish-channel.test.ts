import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Runs the whole publish-with-oidc.sh against a two-package fixture repo with
// npm, bun and git replaced by stubs, so the asserted npm argv is exactly what
// a CI run would send. The canary channel must never name `latest`.

const SCRIPTS_DIR = fileURLToPath(new URL("..", import.meta.url));
const COPIED_SCRIPTS = ["publish-with-oidc.sh", "pack-with-publish-config.sh", "pin-drift.jq"] as const;

const NPM_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB_CALL_LOG"
case "$1" in
  view)
    spec="$2"
    if [[ "\${spec#@}" == *@* ]]; then
      if printf '%s\\n' "\${STUB_PUBLISHED:-}" | grep -qxF "$spec"; then echo "\${spec##*@}"; exit 0; fi
      exit 1
    fi
    if printf '%s\\n' "\${STUB_UNRELEASED_NAMES:-}" | grep -qxF "$spec"; then
      echo "npm error code E404" >&2
      echo "npm error 404 Not Found - GET https://registry.npmjs.org/$spec - Not found" >&2
      exit 1
    fi
    if printf '%s\\n' "\${STUB_LOOKUP_FAILING_NAMES:-}" | grep -qxF "$spec"; then
      echo "npm error code E503" >&2
      echo "npm error 503 Service Unavailable - GET https://registry.npmjs.org/$spec" >&2
      exit 1
    fi
    if [ -n "\${STUB_LATEST:-}" ]; then echo "$STUB_LATEST"; exit 0; fi
    exit 1
    ;;
  *) exit 0 ;;
esac
`;

// Stands in for \`bun pm pack --quiet\` (a tarball holding package.json) and for
// the major-version guard the script runs first.
const BUN_STUB = `#!/usr/bin/env bash
if [ "$1" = "pm" ] && [ "$2" = "pack" ]; then
  tgz="$(jq -r '.name | ltrimstr("@") | gsub("/"; "-")' package.json)-$(jq -r .version package.json).tgz"
  work="$(mktemp -d)"
  mkdir "$work/package"
  cp package.json "$work/package/"
  tar -czf "$tgz" -C "$work" package
  rm -rf "$work"
  printf '\\n%s\\n' "$tgz"
fi
exit 0
`;

const GIT_STUB = "#!/usr/bin/env bash\nexit 0\n";

let stubDir = "";
let repoDir = "";

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), "publish-channel-stubs-"));
  writeFileSync(join(stubDir, "npm"), NPM_STUB, { mode: 0o755 });
  writeFileSync(join(stubDir, "bun"), BUN_STUB, { mode: 0o755 });
  writeFileSync(join(stubDir, "git"), GIT_STUB, { mode: 0o755 });
  repoDir = mkdtempSync(join(tmpdir(), "publish-channel-repo-"));
  mkdirSync(join(repoDir, "scripts"));
  for (const script of COPIED_SCRIPTS) {
    copyFileSync(join(SCRIPTS_DIR, script), join(repoDir, "scripts", script));
  }
});

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

function writePackages(version: string): void {
  rmSync(join(repoDir, "packages"), { recursive: true, force: true });
  mkdirSync(join(repoDir, "packages", "types"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "framework"), { recursive: true });
  writeFileSync(
    join(repoDir, "packages", "types", "package.json"),
    JSON.stringify({ name: "@cosmicdrift/kumiko-types", version }),
  );
  writeFileSync(
    join(repoDir, "packages", "framework", "package.json"),
    JSON.stringify({
      name: "@cosmicdrift/kumiko-framework",
      version,
      dependencies: { "@cosmicdrift/kumiko-types": version },
    }),
  );
}

function runPublish(
  version: string,
  args: readonly string[],
  stubEnv: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string; npmCalls: string[] } {
  writePackages(version);
  const callLog = join(stubDir, "npm-calls.log");
  rmSync(callLog, { force: true });
  const result = Bun.spawnSync(["bash", join(repoDir, "scripts", "publish-with-oidc.sh"), ...args], {
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env["PATH"] ?? ""}`,
      STUB_CALL_LOG: callLog,
      GITHUB_STEP_SUMMARY: join(stubDir, "step-summary.md"),
      ...stubEnv,
    },
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString("utf-8"),
    stderr: result.stderr.toString("utf-8"),
    npmCalls: existsSync(callLog) ? readFileSync(callLog, "utf-8").trim().split("\n") : [],
  };
}

const CANARY = "0.425.0-next-20261118120000-abc1234";
const ON_REGISTRY = { STUB_LATEST: "0.424.1" } as const;

function publishCalls(npmCalls: readonly string[]): string[] {
  return npmCalls.filter((call) => call.startsWith("publish "));
}

describe("publish-with-oidc.sh dist-tag channel", () => {
  test("without an argument every package is published under latest and tagged", () => {
    const { exitCode, stdout, npmCalls } = runPublish("0.425.0", []);

    expect(exitCode).toBe(0);
    const publishes = publishCalls(npmCalls);
    expect(publishes).toHaveLength(2);
    for (const call of publishes) expect(call).toEndWith("--provenance --access public --tag latest");
    expect(stdout).toContain("New tag: @cosmicdrift/kumiko-framework@0.425.0");
  });

  test("next publishes every package under next and never names latest", () => {
    const { exitCode, stdout, npmCalls } = runPublish(CANARY, ["next"], ON_REGISTRY);

    expect(exitCode).toBe(0);
    const publishes = publishCalls(npmCalls);
    expect(publishes).toHaveLength(2);
    for (const call of publishes) expect(call).toEndWith("--provenance --access public --tag next");
    expect(npmCalls.filter((call) => /\blatest\b/.test(call))).toEqual([]);
    expect(stdout).not.toContain("New tag:");
  });

  test("a canary already on the registry moves no dist-tag, even when latest differs", () => {
    const { exitCode, npmCalls } = runPublish(CANARY, ["next"], {
      STUB_PUBLISHED: `@cosmicdrift/kumiko-types@${CANARY}`,
      STUB_LATEST: "0.424.1",
    });

    expect(exitCode).toBe(0);
    expect(npmCalls.filter((call) => call.startsWith("dist-tag add"))).toEqual([]);
    expect(publishCalls(npmCalls)).toHaveLength(1);
  });

  // The registry points `latest` at a package's first-ever version whatever tag
  // the publish names, so a canary must never be that first version.
  test("next skips a package that has never been released", () => {
    const { exitCode, stderr, npmCalls } = runPublish(CANARY, ["next"], {
      ...ON_REGISTRY,
      STUB_UNRELEASED_NAMES: "@cosmicdrift/kumiko-framework",
    });

    expect(exitCode).toBe(0);
    const publishes = publishCalls(npmCalls);
    expect(publishes).toHaveLength(1);
    expect(publishes[0]).toContain("cosmicdrift-kumiko-types-");
    expect(stderr).toContain("[skip] @cosmicdrift/kumiko-framework");
    expect(stderr).toContain("::warning::@cosmicdrift/kumiko-framework has no release on npm yet");
  });

  // Reading an outage as "never released" would skip the package while the other
  // canaries pin it to a version that never reaches the registry.
  test("next fails a package whose registry lookup errors without E404", () => {
    const { exitCode, stderr, npmCalls } = runPublish(CANARY, ["next"], {
      ...ON_REGISTRY,
      STUB_LOOKUP_FAILING_NAMES: "@cosmicdrift/kumiko-framework",
    });

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(`failed: @cosmicdrift/kumiko-framework@${CANARY} (registry lookup failed)`);
    const publishes = publishCalls(npmCalls);
    expect(publishes).toHaveLength(1);
    expect(publishes[0]).toContain("cosmicdrift-kumiko-types-");
  });

  test("an unknown dist-tag aborts before any npm call", () => {
    const { exitCode, stderr, npmCalls } = runPublish(CANARY, ["beta"]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("unknown dist-tag 'beta'");
    expect(npmCalls).toEqual([]);
  });

  test("next refuses a release version", () => {
    const { exitCode, npmCalls } = runPublish("0.425.0", ["next"]);

    expect(exitCode).toBe(1);
    expect(publishCalls(npmCalls)).toEqual([]);
  });

  test("latest refuses a canary version", () => {
    const { exitCode, npmCalls } = runPublish(CANARY, []);

    expect(exitCode).toBe(1);
    expect(publishCalls(npmCalls)).toEqual([]);
  });
});
