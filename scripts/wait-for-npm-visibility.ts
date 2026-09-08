#!/usr/bin/env bun
// registry.npmjs.org's packument response (what Renovate reads for the version
// list) sits behind a CDN that stays stale for minutes after `npm publish` — the
// dist-tags endpoint updates immediately but doesn't list versions, so it can't
// substitute as a readiness check. Dispatching Renovate right after publish let
// it see only part of a lockstep release (fw#2644: bundled-features stuck on
// 0.236.0 while every other package was already on 0.236.1, producing two
// kumiko-types copies and a broken consumer typecheck). This polls the real
// packument until every package published in this run is visible.

import { readFileSync } from "node:fs";
import { Glob } from "bun";

const PACKAGES_DIR = "packages";
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 900_000;

export interface PublishablePackage {
  name: string;
  version: string;
}

type FetchLike = typeof fetch;

export function collectPublishablePackages(packagesDir: string): PublishablePackage[] {
  const packages: PublishablePackage[] = [];
  for (const relPath of new Glob("*/package.json").scanSync(packagesDir)) {
    const pkg = JSON.parse(readFileSync(`${packagesDir}/${relPath}`, "utf-8")) as Record<
      string,
      unknown
    >;
    if (pkg.private === true) continue;
    if (typeof pkg.name === "string" && typeof pkg.version === "string") {
      packages.push({ name: pkg.name, version: pkg.version });
    }
  }
  return packages;
}

export function isVersionVisible(packument: unknown, version: string): boolean {
  if (packument === null || typeof packument !== "object") return false;
  const versions = (packument as Record<string, unknown>).versions;
  if (versions === null || typeof versions !== "object") return false;
  return Object.prototype.hasOwnProperty.call(versions, version);
}

async function fetchPackument(name: string, fetchImpl: FetchLike): Promise<unknown> {
  try {
    const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WaitForNpmVisibilityOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetchImpl?: FetchLike;
}

export interface WaitForNpmVisibilityResult {
  ok: boolean;
  missing: PublishablePackage[];
}

export async function waitForNpmVisibility(
  packages: PublishablePackage[],
  options: WaitForNpmVisibilityOptions = {},
): Promise<WaitForNpmVisibilityResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    fetchImpl = fetch,
  } = options;

  const startedAt = Date.now();
  const pending = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const total = packages.length;

  for (;;) {
    for (const pkg of [...pending.values()]) {
      const packument = await fetchPackument(pkg.name, fetchImpl);
      if (isVersionVisible(packument, pkg.version)) {
        pending.delete(pkg.name);
        console.log(`[wait-for-npm-visibility] visible: ${pkg.name}@${pkg.version}`);
      }
    }

    console.log(`[wait-for-npm-visibility] ${total - pending.size}/${total} packages visible`);

    if (pending.size === 0) {
      return { ok: true, missing: [] };
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return { ok: false, missing: [...pending.values()] };
    }
    await sleep(pollIntervalMs);
  }
}

if (import.meta.main) {
  const packages = collectPublishablePackages(PACKAGES_DIR);
  const timeoutMs = Number(process.env.NPM_VISIBILITY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  const { ok, missing } = await waitForNpmVisibility(packages, { timeoutMs });

  if (!ok) {
    console.error(
      `[wait-for-npm-visibility] timed out waiting for ${missing.length} package(s) to appear in the npm packument: ${missing
        .map((pkg) => `${pkg.name}@${pkg.version}`)
        .join(", ")}`,
    );
    process.exit(1);
  }
  console.log("[wait-for-npm-visibility] all packages visible");
}
