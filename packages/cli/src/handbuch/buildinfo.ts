import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const FRAMEWORK_PACKAGE = "@cosmicdrift/kumiko-framework";

export type BuildInfo = {
  appVersion?: string;
  frameworkVersion?: string;
  frameworkPin?: string;
  git?: { sha: string; branch: string };
  sourceVersions: Array<{ name: string; version: string }>;
  builtAt: string;
};

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : undefined;
  } catch {
    return undefined;
  }
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function resolvedFrameworkVersion(repoDir: string): string | undefined {
  try {
    const manifest = Bun.resolveSync(`${FRAMEWORK_PACKAGE}/package.json`, repoDir);
    return stringField(readJson(manifest), "version");
  } catch {
    return undefined;
  }
}

function gitOutput(repoDir: string, args: string[]): string | undefined {
  try {
    const text = execFileSync("git", ["-C", repoDir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

export function currentWallClock(): WallClock {
  const { year, month, day, hour, minute } = Temporal.Now.zonedDateTimeISO();
  return { year, month, day, hour, minute };
}

const pad2 = (value: number) => String(value).padStart(2, "0");

export function formatGermanDateTime(at: WallClock): string {
  return `${pad2(at.day)}.${pad2(at.month)}.${at.year}, ${pad2(at.hour)}:${pad2(at.minute)}`;
}

export function formatIsoDateTime(at: WallClock): string {
  return `${at.year}-${pad2(at.month)}-${pad2(at.day)} ${pad2(at.hour)}:${pad2(at.minute)}`;
}

export function collectBuildInfo(
  repoDir: string,
  now: WallClock = currentWallClock(),
  extraRepoDirs: readonly string[] = [],
  locale = "de",
): BuildInfo {
  const manifest = readJson(join(repoDir, "package.json"));
  const dependencies = manifest?.["dependencies"];
  const declared =
    typeof dependencies === "object" && dependencies !== null
      ? Object.entries(dependencies).find(([name]) => name === FRAMEWORK_PACKAGE)?.[1]
      : undefined;
  const frameworkVersion = resolvedFrameworkVersion(repoDir);
  const pin = typeof declared === "string" ? declared : undefined;
  const sha = gitOutput(repoDir, ["rev-parse", "--short", "HEAD"]);
  const branch = gitOutput(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return {
    appVersion: stringField(manifest, "version"),
    frameworkVersion,
    frameworkPin: pin && pin !== frameworkVersion ? pin : undefined,
    git: sha && branch ? { sha, branch } : undefined,
    sourceVersions: extraRepoDirs.flatMap((dir) => {
      const version = stringField(readJson(join(dir, "package.json")), "version");
      return version ? [{ name: basename(dir), version }] : [];
    }),
    builtAt: locale === "de" ? formatGermanDateTime(now) : formatIsoDateTime(now),
  };
}

export function buildInfoLines(info: BuildInfo, builtLabel = "Stand"): string[] {
  const lines: string[] = [];
  if (info.appVersion) lines.push(`App ${info.appVersion}`);
  if (info.frameworkVersion) {
    lines.push(
      `Kumiko ${info.frameworkVersion}${info.frameworkPin ? ` (Pin ${info.frameworkPin})` : ""}`,
    );
  }
  if (info.git) lines.push(`${info.git.branch} @ ${info.git.sha}`);
  for (const source of info.sourceVersions) lines.push(`${source.name} ${source.version}`);
  lines.push(`${builtLabel} ${info.builtAt}`);
  return lines;
}
