import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { z } from "zod";

export const REPO_MANIFEST_FILE = "kumiko.json";

export const repoKindSchema = z.enum(["framework", "library", "app"]);
export type RepoKind = z.infer<typeof repoKindSchema>;

const DRIVE_LETTER_RE = /^[A-Za-z]:/;

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function patternViolation(value: string): string | undefined {
  if (isBlank(value)) return `must not be empty: "${value}"`;
  if (value.includes("\0")) return `must not contain a NUL character: "${value}"`;
  if (value.startsWith("/") || DRIVE_LETTER_RE.test(value)) {
    return `must be relative to the repo root: "${value}"`;
  }
  if (value.includes("\\")) return `must use forward slashes, not backslashes: "${value}"`;
  if (value.startsWith("!")) return `must not start with "!": "${value}"`;
  if (value.split("/").some((segment) => segment === "..")) {
    return `must not traverse outside the repo root: "${value}"`;
  }
  return undefined;
}

const pattern = z.string().superRefine((value, ctx) => {
  const violation = patternViolation(value);
  if (violation !== undefined) {
    ctx.addIssue({ code: "custom", message: violation });
  }
});

export const repoManifestSchema = z.strictObject({
  kind: repoKindSchema,
  sourceRoots: z.array(pattern).min(1),
  testGlobs: z.array(pattern).min(1),
  uiRoots: z.array(pattern).optional(),
  excludes: z.array(pattern).optional(),
});
export type RepoManifest = z.infer<typeof repoManifestSchema>;

export type RepoManifestSource = "file" | "derived";

export type LoadedRepoManifest = {
  readonly manifest: RepoManifest;
  readonly source: RepoManifestSource;
  readonly manifestPath: string;
};

export class RepoManifestError extends Error {
  readonly manifestPath: string;

  constructor(manifestPath: string, message: string) {
    super(`${manifestPath}: ${message}`);
    this.name = "RepoManifestError";
    this.manifestPath = manifestPath;
  }
}

export type LoadRepoManifestOptions = {
  readonly warn?: (message: string) => void;
};

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function isWithinRoot(candidateReal: string, rootReal: string): boolean {
  return candidateReal === rootReal || candidateReal.startsWith(rootReal + sep);
}

// Static prefix (pre-glob segments) is what a symlink escape must hide behind — the glob tail never resolves to a real path.
const GLOB_METACHARACTER_RE = /[*?[\]{}]/;

function staticPatternBase(value: string): string {
  const staticSegments: string[] = [];
  for (const segment of value.split("/")) {
    if (GLOB_METACHARACTER_RE.test(segment)) break;
    staticSegments.push(segment);
  }
  return staticSegments.join("/");
}

function assertPatternsResolveWithinRoot(
  manifestPath: string,
  rootAbs: string,
  rootReal: string,
  manifest: RepoManifest,
): void {
  const patterns = [
    ...manifest.sourceRoots,
    ...manifest.testGlobs,
    ...(manifest.uiRoots ?? []),
    ...(manifest.excludes ?? []),
  ];
  for (const value of patterns) {
    const base = staticPatternBase(value);
    if (base.length === 0) continue;
    // Walk segment by segment — a symlink can escape before the full base path exists on disk (e.g. "linked/src" whose target has no "src").
    let relSoFar = "";
    for (const segment of base.split("/")) {
      relSoFar = relSoFar.length === 0 ? segment : `${relSoFar}/${segment}`;
      const segmentAbs = join(rootAbs, relSoFar);
      if (!existsSync(segmentAbs)) break;
      const segmentReal = realpathSync(segmentAbs);
      if (!isWithinRoot(segmentReal, rootReal)) {
        throw new RepoManifestError(manifestPath, `"${value}" resolves outside the repo root`);
      }
    }
  }
}

function loadManifestFile(
  manifestPath: string,
  rootAbs: string,
  rootReal: string,
): LoadedRepoManifest {
  const manifestReal = realpathSync(manifestPath);
  if (!isWithinRoot(manifestReal, rootReal)) {
    throw new RepoManifestError(manifestPath, "resolves outside the repo root");
  }

  const raw = readFileSync(manifestPath, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepoManifestError(manifestPath, `invalid JSON — ${message}`);
  }

  const result = repoManifestSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new RepoManifestError(manifestPath, `invalid repo manifest — ${issues}`);
  }

  assertPatternsResolveWithinRoot(manifestPath, rootAbs, rootReal, result.data);

  return { manifest: result.data, source: "file", manifestPath };
}

function hasPackagesSrcLayout(rootAbs: string): boolean {
  const packagesDir = join(rootAbs, "packages");
  if (!isDirectory(packagesDir)) return false;
  return readdirSync(packagesDir, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && isDirectory(join(packagesDir, entry.name, "src")),
  );
}

type DerivedLayout = { readonly layout: string; readonly manifest: RepoManifest };

function derivedLayoutFor(rootAbs: string): DerivedLayout | undefined {
  if (hasPackagesSrcLayout(rootAbs)) {
    return {
      layout: "packages/*/src",
      manifest: {
        kind: "library",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.{test,integration}.{ts,tsx}"],
      },
    };
  }
  if (isDirectory(join(rootAbs, "src"))) {
    return {
      layout: "src",
      manifest: {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
      },
    };
  }
  return undefined;
}

function deriveManifest(
  manifestPath: string,
  rootAbs: string,
  warn: (message: string) => void,
): LoadedRepoManifest {
  const derived = derivedLayoutFor(rootAbs);

  if (!derived) {
    throw new RepoManifestError(
      manifestPath,
      "not found and no packages/*/src or src/ layout to derive one from",
    );
  }

  warn(
    `${manifestPath} not found — derived "${derived.layout}" layout (kind "${derived.manifest.kind}"); ` +
      "add a kumiko.json to declare the repo layout explicitly",
  );

  return { manifest: derived.manifest, source: "derived", manifestPath };
}

function defaultWarn(message: string): void {
  // biome-ignore lint/suspicious/noConsole: no logger is wired when the manifest loads
  console.warn(message);
}

export function loadRepoManifest(
  root: string,
  options: LoadRepoManifestOptions = {},
): LoadedRepoManifest {
  const rootAbs = resolve(root);
  const manifestPath = join(rootAbs, REPO_MANIFEST_FILE);

  if (!isDirectory(rootAbs)) {
    throw new RepoManifestError(manifestPath, "repo root does not exist or is not a directory");
  }

  if (existsSync(manifestPath)) {
    return loadManifestFile(manifestPath, rootAbs, realpathSync(rootAbs));
  }

  return deriveManifest(manifestPath, rootAbs, options.warn ?? defaultWarn);
}
