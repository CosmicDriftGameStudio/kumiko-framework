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

/**
 * Rewrites each workspace `"version"` field in a bun.lock to match its
 * package.json. Pure — no IO — so the regex/format contract is unit-testable.
 * Returns the patched lock plus a human-readable list of the changes made.
 */
export function syncLockVersions(
  lock: string,
  nameToVersion: ReadonlyMap<string, string>,
): { lock: string; changed: string[] } {
  const changed: string[] = [];
  for (const [name, version] of nameToVersion) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Workspace entries are `"name": "<pkg>",` immediately followed by
    // `"version": "<v>",` (registry deps use a different array form, so this
    // pair only matches workspace blocks).
    const re = new RegExp(`("name": "${escaped}",\\s*\\n\\s*"version": ")([^"]*)(")`);
    lock = lock.replace(re, (_m: string, pre: string, current: string, post: string) => {
      if (current !== version) {
        changed.push(`${name}: ${current} → ${version}`);
      }
      return `${pre}${version}${post}`;
    });
  }
  return { lock, changed };
}

if (import.meta.main) {
  const nameToVersion = new Map<string, string>();
  for await (const path of new Glob("packages/*/package.json").scan(".")) {
    const pkg = await Bun.file(path).json();
    if (typeof pkg.name === "string" && typeof pkg.version === "string") {
      nameToVersion.set(pkg.name, pkg.version);
    }
  }

  const { lock, changed } = syncLockVersions(await Bun.file(LOCK_PATH).text(), nameToVersion);
  if (changed.length > 0) {
    await Bun.write(LOCK_PATH, lock);
  }
  console.log(
    changed.length > 0
      ? `[sync-lock] synced ${changed.length} workspace version(s):\n  ${changed.join("\n  ")}`
      : "[sync-lock] bun.lock workspace versions already match package.json",
  );
}
