export type DockerStage = { readonly lines: readonly string[] };

export const NPM_AUTH_SECRET_ID = "npm_auth_token";

const FROM_RE = /^\s*FROM\s/i;
const BUN_INSTALL_RE = /^\s*RUN\s+.*\bbun\s+install\b/;
const COPY_FROM_RE = /^\s*COPY\s+--from=/;
const COPY_RE = /^\s*COPY\s+/;
const COPY_CONTEXT_RE = /^\s*COPY\s+(?:--\S+\s+)*\.\/?\s+\S+\s*$/;
const LEGACY_TOKEN_ARG_RE = /^\s*ARG\s+(\S+\s+)*NPM_AUTH_TOKEN(\s*=.*)?\s*$/;
const LEGACY_TOKEN_ENV_RE = /^\s*ENV\s+.*\bNPM_AUTH_TOKEN\b/;

// Docker line continuations (`\` at EOL) merged so a multi-line RUN/COPY
// still matches as one logical instruction.
export function joinContinuations(dockerfileText: string): string[] {
  const out: string[] = [];
  let buffer = "";
  for (const raw of dockerfileText.split("\n")) {
    const line = raw.replace(/\r$/, "");
    buffer = buffer.length > 0 ? `${buffer} ${line}` : line;
    if (/\\\s*$/.test(line)) {
      buffer = buffer.replace(/\\\s*$/, "");
      continue;
    }
    out.push(buffer);
    buffer = "";
  }
  if (buffer.length > 0) out.push(buffer);
  return out;
}

export function splitStages(lines: readonly string[]): DockerStage[] {
  const stages: DockerStage[] = [];
  let current: string[] | undefined;
  for (const line of lines) {
    if (FROM_RE.test(line)) {
      if (current) stages.push({ lines: current });
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) stages.push({ lines: current });
  return stages;
}

export function linesBeforeFirstFrom(lines: readonly string[]): readonly string[] {
  const firstFrom = lines.findIndex((line) => FROM_RE.test(line));
  return firstFrom === -1 ? lines : lines.slice(0, firstFrom);
}

// The runtime stage's `bun install --production` never pulls devDependencies;
// only a full install needs registry auth for every private package.
export function isAuthedInstallLine(line: string): boolean {
  return BUN_INSTALL_RE.test(line) && !/--production\b/.test(line);
}

// Identified by what it does, not by its `AS <name>` label.
export function findBuildStage(stages: readonly DockerStage[]): DockerStage | undefined {
  return stages.find((stage) => stage.lines.some(isAuthedInstallLine));
}

function isLegacyTokenArgOrEnv(line: string): boolean {
  return LEGACY_TOKEN_ARG_RE.test(line) || LEGACY_TOKEN_ENV_RE.test(line);
}

// Covers a direct `ARG GITHUB_TOKEN` too, not only the NPM_AUTH_TOKEN
// re-export: any build-arg carrying the token lands in the image history.
export function declaresRegistryTokenAsArgOrEnv(
  line: string,
  tokenVariables: ReadonlySet<string>,
): boolean {
  if (isLegacyTokenArgOrEnv(line)) return true;
  const declared = /^\s*(?:ARG|ENV)\s+(.*)$/.exec(line)?.[1];
  if (declared === undefined) return false;
  return [...tokenVariables].some((variable) =>
    new RegExp(`(^|\\s)${variable}(=|\\s|$)`).test(declared),
  );
}

export function declaresLegacyTokenArg(line: string): boolean {
  return LEGACY_TOKEN_ARG_RE.test(line);
}

// A mount that only lands at /run/secrets passes BuildKit but 401s in the
// install: the RUN must expose the secret under a variable the registry
// config reads, via the mount's `env=` option or an inline assignment.
export function mountsNpmAuthSecret(line: string, tokenVariables: ReadonlySet<string>): boolean {
  return [...line.matchAll(/--mount=(\S+)/g)].some((match) => {
    const options = (match[1] ?? "").split(",");
    if (!options.includes("type=secret") || !options.includes(`id=${NPM_AUTH_SECRET_ID}`)) {
      return false;
    }
    return [...tokenVariables].some(
      (variable) => options.includes(`env=${variable}`) || new RegExp(`\\b${variable}=`).test(line),
    );
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `COPY . .` carries every file of the build context, so it counts for any name.
export function isCopiedBeforeInstall(stage: DockerStage | undefined, filename: string): boolean {
  if (!stage) return false;
  const installIdx = stage.lines.findIndex(isAuthedInstallLine);
  const relevant = installIdx === -1 ? stage.lines : stage.lines.slice(0, installIdx);
  const fileToken = new RegExp(`(^|\\s|/)${escapeRegExp(filename)}(\\s|$)`);
  return relevant.some(
    (line) =>
      !COPY_FROM_RE.test(line) &&
      COPY_RE.test(line) &&
      (fileToken.test(line) || COPY_CONTEXT_RE.test(line)),
  );
}
