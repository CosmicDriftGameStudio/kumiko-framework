// Warn-only: lists docs screenshots that are much older than the UI code they depict. Never fails.
import { $ } from "bun";

const SCREENSHOT_GLOB = "docs/**/*.png";
const UI_SOURCES = ["packages/renderer/src", "packages/document-designer/src"];
const STALE_AFTER_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

async function lastCommitSeconds(paths: readonly string[]): Promise<number | undefined> {
  const out = await $`git log -1 --format=%ct -- ${paths}`.nothrow().quiet().text();
  const seconds = Number.parseInt(out.trim(), 10);
  return Number.isNaN(seconds) ? undefined : seconds;
}

const uiSeconds = await lastCommitSeconds(UI_SOURCES);
const tracked = (await $`git ls-files ${SCREENSHOT_GLOB}`.nothrow().quiet().text())
  .split("\n")
  .filter(Boolean);

const stale: string[] = [];
for (const file of tracked) {
  const shotSeconds = await lastCommitSeconds([file]);
  if (uiSeconds === undefined || shotSeconds === undefined) continue;
  const ageDays = Math.floor((uiSeconds - shotSeconds) / SECONDS_PER_DAY);
  if (ageDays > STALE_AFTER_DAYS) stale.push(`  ${file}: ${ageDays} days older than the latest UI change`);
}

if (stale.length > 0) {
  console.warn(`warning: ${stale.length} doc screenshot(s) may be outdated (warn-only)`);
  console.warn(stale.join("\n"));
}
