#!/usr/bin/env bun
/**
 * Guard: a consumer repo's `.kumiko/upgrade-state.json` marker must be
 * caught up with the installed Kumiko framework version.
 *
 * The marker is written by `kumiko-upgrade --apply` (local bin from
 * `@cosmicdrift/kumiko-dev-server`) and records the version it was applied
 * at. This guard re-runs `kumiko-upgrade --from <marker version> --json` and
 * fails if any changelog entries are still pending — meaning the marker is
 * stale and the repo hasn't run the upgrade since.
 *
 * Single-repo only, like `guard-upgrade-state.ts` in infra/guards but
 * without that package's multi-repo `resolveRepoRoots()` scan loop — this
 * package's `resolveRepoRoots()` only ever resolves the one repo `roots[0]`
 * sits in. Repos without the marker file are `notApplicable` — this guard
 * only fires once a repo has adopted the upgrade-state workflow at all.
 *
 * Usage:
 *   bun guard-upgrade-state.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type GuardViolation,
  type RepoCheck,
  reportResults,
  runRepoChecks,
} from "./_lib/guard-kit";

const MARKER_REL = ".kumiko/upgrade-state.json";
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

type UpgradeMarker = { readonly version: string };

type PendingEntry = {
  readonly version: string;
  readonly type: string;
  readonly title: string;
};

type UpgradeJson = {
  readonly currentVersion: string;
  readonly installedVersion?: string | null;
  readonly pending: readonly PendingEntry[];
};

export function resolveInstalledVersion(json: UpgradeJson): string {
  return json.installedVersion ?? json.currentVersion;
}

export function isPendingEntry(value: unknown): value is PendingEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["version"] === "string" &&
    typeof v["type"] === "string" &&
    typeof v["title"] === "string"
  );
}

export function isUpgradeJson(value: unknown): value is UpgradeJson {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const installed = v["installedVersion"];
  return (
    typeof v["currentVersion"] === "string" &&
    (installed === undefined || installed === null || typeof installed === "string") &&
    Array.isArray(v["pending"]) &&
    v["pending"].every(isPendingEntry)
  );
}

export function readMarker(root: string): UpgradeMarker | { error: string } {
  const markerPath = join(root, MARKER_REL);
  if (!existsSync(markerPath)) {
    return {
      error: `missing ${MARKER_REL} — run \`bun run kumiko-upgrade --apply\` once and commit the marker file`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(markerPath, "utf-8"));
  } catch {
    return { error: `${MARKER_REL} is not valid JSON — broken marker file` };
  }
  const version =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)["version"]
      : undefined;
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    return {
      error: `${MARKER_REL} is missing a valid "version" field (expected semver x.y.z[-pre][+build]) — broken marker file`,
    };
  }
  return { version };
}

/** Pending changelog entries turned into guard violations — pure, testable without a subprocess. */
export function pendingViolations(json: UpgradeJson, markerVersion: string): GuardViolation[] {
  if (json.pending.length === 0) return [];
  const installedVersion = resolveInstalledVersion(json);
  return json.pending.map((entry) => ({
    file: MARKER_REL,
    line: 1,
    message:
      `${MARKER_REL} is at ${markerVersion}, installed is ${installedVersion} — pending: ` +
      `${entry.version} · ${entry.type} · ${entry.title}. Run \`bun run kumiko-upgrade --apply\`.`,
  }));
}

function resolveKumikoUpgradeBin(cwd: string): string | undefined {
  const which = Bun.which("kumiko-upgrade");
  if (which) return which;
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, "node_modules", ".bin", "kumiko-upgrade");
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

async function runKumikoUpgrade(
  version: string,
  cwd: string,
): Promise<{ ok: true; json: UpgradeJson } | { ok: false; error: string }> {
  const binPath = resolveKumikoUpgradeBin(cwd);
  if (!binPath) {
    return {
      ok: false,
      error:
        "`kumiko-upgrade` not resolvable — add `@cosmicdrift/kumiko-dev-server` as a devDependency or repair the install",
    };
  }
  const proc = Bun.spawn({
    cmd: [binPath, "--from", version, "--json"],
    cwd,
    env: { ...process.env, INIT_CWD: cwd },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    return {
      ok: false,
      error: `\`kumiko-upgrade --from ${version} --json\` exited ${exitCode}:\n${stderr || stdout}`,
    };
  }
  let parsed: unknown;
  try {
    const jsonStart = stdout.indexOf("{");
    parsed = JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart) : stdout);
  } catch {
    return {
      ok: false,
      error: `\`kumiko-upgrade --from ${version} --json\` did not print valid JSON:\n${stdout}${stderr}`,
    };
  }
  if (!isUpgradeJson(parsed)) {
    return {
      ok: false,
      error: `\`kumiko-upgrade --from ${version} --json\` printed JSON without a valid "pending" array:\n${stdout}`,
    };
  }
  return { ok: true, json: parsed };
}

export const check: RepoCheck = {
  name: "Upgrade-State Guard",
  hint: "Marker is written by `kumiko-upgrade --apply` — run it once the pending changelog entries are handled.",
  async run(roots) {
    const root = roots[0];
    if (!root) return { violations: [], matchedFiles: 0, notApplicable: true };
    const rootAbsPath = root.absPath;
    if (!existsSync(join(rootAbsPath, MARKER_REL))) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }
    const marker = readMarker(rootAbsPath);
    if ("error" in marker) {
      return {
        violations: [{ file: MARKER_REL, line: 1, message: marker.error }],
        matchedFiles: 1,
        notApplicable: false,
      };
    }
    const result = await runKumikoUpgrade(marker.version, rootAbsPath);
    if (!result.ok) {
      return {
        violations: [{ file: MARKER_REL, line: 1, message: result.error }],
        matchedFiles: 1,
        notApplicable: false,
      };
    }
    return {
      violations: pendingViolations(result.json, marker.version),
      matchedFiles: 1,
      notApplicable: false,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
