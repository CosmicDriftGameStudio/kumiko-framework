/** `*.test.ts(x)`, `*.integration.ts(x)` and `*.integration.test.ts(x)`. */
export const TEST_FILE_RE = /\.(?:test|integration)(?:\.test)?\.tsx?$/;

export function isTestFilePath(filePath: string): boolean {
  return filePath.split("/").includes("__tests__") || TEST_FILE_RE.test(filePath);
}
