// Port registry across the apps of a workspace: every app declares its ports
// in kumiko.config.ts, and two apps (or two roles of one app) must never claim
// the same port, otherwise their local dev and E2E runs block each other.
import { type Dirent, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  APP_CONFIG_FILE,
  type AppPortRole,
  listAppPorts,
} from "@cosmicdrift/kumiko-framework/config";
import { readStaticAppConfig, type StaticAppConfig } from "./static-app-config.ts";

export type ScannedApp = { readonly app: string; readonly config: StaticAppConfig };

export type PortClaim = { readonly app: string; readonly role: AppPortRole };

export type PortCollision = { readonly port: number; readonly claims: readonly PortClaim[] };

function scannableSubdirs(dir: string): readonly Dirent[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
  );
}

/** Children of `root` with a kumiko.config.ts, and `<child>/apps/*` of a monorepo child without one; worktrees and dot-dirs are skipped. */
export function scanWorkspaceApps(root: string): readonly ScannedApp[] {
  const apps: ScannedApp[] = [];
  for (const child of scannableSubdirs(root)) {
    const childDir = join(root, child.name);
    if (existsSync(join(childDir, APP_CONFIG_FILE))) {
      apps.push({ app: child.name, config: readStaticAppConfig(childDir) });
      continue;
    }
    for (const nested of scannableSubdirs(join(childDir, "apps"))) {
      const nestedDir = join(childDir, "apps", nested.name);
      if (!existsSync(join(nestedDir, APP_CONFIG_FILE))) continue;
      apps.push({
        app: `${child.name}/apps/${nested.name}`,
        config: readStaticAppConfig(nestedDir),
      });
    }
  }
  return apps.sort((a, b) => a.app.localeCompare(b.app));
}

export function findPortCollisions(apps: readonly ScannedApp[]): readonly PortCollision[] {
  const claimsByPort = new Map<number, PortClaim[]>();
  for (const { app, config } of apps) {
    if (config.kind !== "defined") continue;
    for (const { role, port } of listAppPorts(config.ports)) {
      const claims = claimsByPort.get(port) ?? [];
      claims.push({ app, role });
      claimsByPort.set(port, claims);
    }
  }
  return [...claimsByPort.entries()]
    .filter(([, claims]) => claims.length > 1)
    .map(([port, claims]) => ({ port, claims }))
    .sort((a, b) => a.port - b.port);
}
