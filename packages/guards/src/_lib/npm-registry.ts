// Registry lookups go through `bun info` (honors the project's registry/auth config) instead of raw HTTP.

export type LatestRelease = {
  readonly version: string;
  readonly publishedAt: string;
};

export type DeprecationLookup =
  | { readonly kind: "deprecated"; readonly message: string }
  | { readonly kind: "current" }
  | { readonly kind: "unknown"; readonly reason: string };

export type RegistryClient = {
  /** Deprecation status of one exact version; `unknown` when the registry could not answer. */
  deprecation(name: string, version: string): Promise<DeprecationLookup>;
  /** Latest dist-tag with its publish date; `null` when unknown. */
  latestRelease(name: string): Promise<LatestRelease | null>;
};

const BUN_INFO_TIMEOUT_MS = 30_000;

export type BunInfoResult =
  | { readonly ok: true; readonly exitCode: number; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

async function bunInfoJson(cwd: string, args: readonly string[]): Promise<BunInfoResult> {
  try {
    const proc = Bun.spawn(["bun", "info", ...args, "--json"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout: BUN_INFO_TIMEOUT_MS,
    });
    const [out, err, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (out.trim() === "") {
      const firstErrorLine = err.trim().split("\n")[0];
      return { ok: false, reason: firstErrorLine || `bun info exited ${exitCode} without output` };
    }
    return { ok: true, exitCode, value: JSON.parse(out) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `bun info <pkg>@<v> deprecated` answers a version without the field with exit 1 and {"error":"Property not found"}.
function isPropertyNotFound(value: unknown): boolean {
  return isRecord(value) && value["error"] === "Property not found";
}

export function interpretDeprecationLookup(result: BunInfoResult): DeprecationLookup {
  if (!result.ok) return { kind: "unknown", reason: result.reason };
  if (isPropertyNotFound(result.value)) return { kind: "current" };
  if (result.exitCode === 0 && typeof result.value === "string") {
    return result.value === ""
      ? { kind: "current" }
      : { kind: "deprecated", message: result.value };
  }
  return { kind: "unknown", reason: `unexpected bun info answer (exit ${result.exitCode})` };
}

/** `cwd` must contain a package.json — `bun info` refuses to run without one. */
export function createBunInfoClient(cwd: string): RegistryClient {
  return {
    async deprecation(name, version) {
      return interpretDeprecationLookup(
        await bunInfoJson(cwd, [`${name}@${version}`, "deprecated"]),
      );
    },
    async latestRelease(name) {
      const version = await bunInfoJson(cwd, [name, "dist-tags.latest"]);
      if (!version.ok || version.exitCode !== 0 || typeof version.value !== "string") return null;
      const time = await bunInfoJson(cwd, [name, "time"]);
      const publishedAt = time.ok && isRecord(time.value) ? time.value[version.value] : undefined;
      return typeof publishedAt === "string" ? { version: version.value, publishedAt } : null;
    },
  };
}

/** Memoizes per call key, so a package listed twice costs one lookup. */
export function memoizeRegistryClient(client: RegistryClient): RegistryClient {
  const deprecation = new Map<string, Promise<DeprecationLookup>>();
  const latest = new Map<string, Promise<LatestRelease | null>>();
  return {
    deprecation(name, version) {
      const key = `${name}@${version}`;
      const cached = deprecation.get(key);
      if (cached) return cached;
      const pending = client.deprecation(name, version);
      deprecation.set(key, pending);
      return pending;
    },
    latestRelease(name) {
      const cached = latest.get(name);
      if (cached) return cached;
      const pending = client.latestRelease(name);
      latest.set(name, pending);
      return pending;
    },
  };
}

export function parseMajor(version: string): number | null {
  const match = version.match(/^(\d+)/);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

export type MajorLagWarning = {
  readonly name: string;
  readonly current: string;
  readonly latest: string;
  readonly latestPublished: string;
};

export function findMajorLagWarning(
  name: string,
  currentVersion: string,
  release: LatestRelease,
  lagMonths: number,
  nowMs: number,
): MajorLagWarning | null {
  const currentMajor = parseMajor(currentVersion);
  const latestMajor = parseMajor(release.version);
  if (currentMajor === null || latestMajor === null || latestMajor <= currentMajor) return null;

  let published: Temporal.Instant;
  try {
    published = Temporal.Instant.from(release.publishedAt);
  } catch {
    return null;
  }
  const cutoff = Temporal.Instant.fromEpochMilliseconds(nowMs)
    .toZonedDateTimeISO("UTC")
    .subtract({ months: lagMonths });
  if (Temporal.Instant.compare(published, cutoff.toInstant()) > 0) return null;

  return {
    name,
    current: currentVersion,
    latest: release.version,
    latestPublished: release.publishedAt,
  };
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      const item = items[i];
      if (item !== undefined) results[i] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
