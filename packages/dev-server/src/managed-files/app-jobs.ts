// Jobs named `app-<name>` in a managed workflow belong to the app: drift
// checks ignore them and a sync carries them over.
const JOBS_HEADER = /^jobs:\s*$/;
const JOB_START = /^ {2}["']?([A-Za-z0-9_-]+)["']?:\s*(?:#.*)?$/;
const TOP_LEVEL_KEY = /^[^\s#]/;
const APP_JOB_PREFIX = "app-";

type JobBlock = { readonly name: string; readonly start: number; readonly end: number };

function isDetachedComment(line: string): boolean {
  return /^ {2}#/.test(line);
}

function findJobBlocks(lines: readonly string[]): readonly JobBlock[] {
  const header = lines.findIndex((line) => JOBS_HEADER.test(line));
  if (header === -1) return [];
  const starts: { name: string; start: number }[] = [];
  let jobsEnd = lines.length;
  for (let index = header + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (TOP_LEVEL_KEY.test(line)) {
      jobsEnd = index;
      break;
    }
    const match = JOB_START.exec(line);
    if (match?.[1] !== undefined) starts.push({ name: match[1], start: index });
  }
  return starts.map(({ name, start }, position) => {
    let end = starts[position + 1]?.start ?? jobsEnd;
    // Comments and blank lines right above the next job introduce that job.
    while (end > start + 1 && (isDetachedComment(lines[end - 1] ?? "") || lines[end - 1] === "")) {
      end--;
    }
    return { name, start: introStart(lines, start, starts[position - 1]), end };
  });
}

function introStart(
  lines: readonly string[],
  start: number,
  previous: { name: string; start: number } | undefined,
): number {
  let first = start;
  const floor = previous === undefined ? 0 : previous.start + 1;
  while (first > floor && isDetachedComment(lines[first - 1] ?? "")) first--;
  return first;
}

function appJobBlocks(lines: readonly string[]): readonly JobBlock[] {
  return findJobBlocks(lines).filter((block) => block.name.startsWith(APP_JOB_PREFIX));
}

export function stripAppJobs(content: string): string {
  const lines = content.split("\n");
  const removed = new Set<number>();
  for (const { start, end } of appJobBlocks(lines)) {
    for (let index = start; index < end; index++) removed.add(index);
    if (lines[start - 1] === "") removed.add(start - 1);
  }
  return lines.filter((_, index) => !removed.has(index)).join("\n");
}

export function appJobsOf(content: string): string {
  const lines = content.split("\n");
  return appJobBlocks(lines)
    .map(({ start, end }) => lines.slice(start, end).join("\n"))
    .join("\n\n");
}

/** Appends the app-owned jobs of `existing` to a freshly rendered workflow. */
export function withAppJobsOf(rendered: string, existing: string): string {
  const appJobs = appJobsOf(existing);
  if (appJobs === "") return rendered;
  return `${rendered.replace(/\n+$/, "")}\n\n${appJobs}\n`;
}
