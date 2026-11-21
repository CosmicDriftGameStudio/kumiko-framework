import {
  BALLAST_PATH_PREFIXES,
  BALLAST_PATH_SEGMENTS,
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_NAME_LENGTH,
} from "./constants.ts";

// Case-insensitive: Windows and macOS file systems are, and the satellite sends the path as it found it.
export function isBallastPath(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => {
    const lowered = segment.toLowerCase();
    return (
      BALLAST_PATH_SEGMENTS.includes(lowered) ||
      BALLAST_PATH_PREFIXES.some((prefix) => lowered.startsWith(prefix))
    );
  });
}

// Folder names become tree nodes, so depth and name length are capped (the file name is not a node but obeys the same length).
export function exceedsFolderLimits(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return (
    segments.length - 1 > MAX_FOLDER_DEPTH ||
    segments.some((segment) => segment.length > MAX_FOLDER_NAME_LENGTH)
  );
}

export function fileNameOf(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}
