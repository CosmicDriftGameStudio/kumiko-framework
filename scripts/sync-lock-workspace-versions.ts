#!/usr/bin/env bun
// `changeset version` bumps each package.json, but `bun install` does NOT refresh
// the workspace "version" fields in bun.lock — verified empirically: after a bump
// `bun install` leaves them stale (no lock diff); only `rm bun.lock && bun install`
// updates them, and that also drifts every floating dependency. `bun pm pack`
// substitutes workspace:* from those lock version fields at publish, so a stale
// field = a stale internal @cosmicdrift/* pin = the publish-with-oidc pin-drift
// guard fails the release (this is what broke the 0.67.0 publish, 7/8 packages).
//
// This re-syncs only the lock's workspace "version" fields to their package.json,
// surgically — no dependency drift. Runs in changeset-version.sh after bun install.

import { Glob } from "bun";

const LOCK_PATH = "bun.lock";

// Pure — no IO — so the format contract is unit-testable.
export function syncLockVersions(
  lock: string,
  nameToVersion: ReadonlyMap<string, string>,
): { lock: string; changed: string[]; unmatched: string[] } {
  const changed: string[] = [];
  const unmatched: string[] = [];
  for (const [name, version] of nameToVersion) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Workspace entries are `"name": "<pkg>",` immediately followed by
    // `"version": "<v>",` (registry deps use a different array form, so this
    // pair only matches workspace blocks).
    const re = new RegExp(`("name": "${escaped}",\\s*\\n\\s*"version": ")([^"]*)(")`);
    let matched = false;
    lock = lock.replace(re, (_m: string, pre: string, current: string, post: string) => {
      matched = true;
      if (current !== version) {
        changed.push(`${name}: ${current} → ${version}`);
      }
      return `${pre}${version}${post}`;
    });
    if (!matched) unmatched.push(name);
  }
  return { lock, changed, unmatched };
}

if (import.meta.main) {
  const nameToVersion = new Map<string, string>();
  for await (const path of new Glob("packages/*/package.json").scan(".")) {
    const pkg = await Bun.file(path).json();
    if (typeof pkg.name === "string" && typeof pkg.version === "string") {
      nameToVersion.set(pkg.name, pkg.version);
    }
  }

  const { lock, changed, unmatched } = syncLockVersions(
    await Bun.file(LOCK_PATH).text(),
    nameToVersion,
  );
  // A workspace package the regex never matched = the lock's name/version block
  // format drifted. Silently exiting 0 here is exactly how stale internal pins
  // shipped before (the 0.67.0 break): no sync, no warning. Fail loud instead.
  if (unmatched.length > 0) {
    console.error(
      `[sync-lock] FATAL: ${unmatched.length} workspace package(s) not found in ${LOCK_PATH} — lock format may have drifted:\n  ${unmatched.join("\n  ")}`,
    );
    process.exit(1);
  }
  if (changed.length > 0) {
    await Bun.write(LOCK_PATH, lock);
  }
  console.log(
    changed.length > 0
      ? `[sync-lock] synced ${changed.length} workspace version(s):\n  ${changed.join("\n  ")}`
      : "[sync-lock] bun.lock workspace versions already match package.json",
  );
}
