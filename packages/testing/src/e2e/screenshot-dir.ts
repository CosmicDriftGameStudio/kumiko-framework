export const SCREENSHOT_DIR_ENV = "SCREENSHOT_DIR";

const NORMAL_RUN_IGNORE: readonly string[] = [
  "**/screenshots.spec.ts",
  "**/*.screenshots.spec.ts",
  "**/screenshots/**",
];

type Env = Readonly<Record<string, string | undefined>>;

function isScreenshotRun(env: Env): boolean {
  const dir = env[SCREENSHOT_DIR_ENV];
  return dir !== undefined && dir !== "";
}

export function requireScreenshotDir(env: Env = process.env): string {
  const dir = env[SCREENSHOT_DIR_ENV];
  if (dir === undefined || dir === "") {
    throw new Error(
      `${SCREENSHOT_DIR_ENV} is required for screenshot runs: set it to the directory the PNGs are written to (e.g. ${SCREENSHOT_DIR_ENV}=$(mktemp -d)). There is deliberately no default, because a default path would overwrite the committed docs images on every run.`,
    );
  }
  return dir;
}

export function screenshotSpecsIgnore(env: Env = process.env): string[] {
  return isScreenshotRun(env) ? [] : [...NORMAL_RUN_IGNORE];
}
