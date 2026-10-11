import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { collectBuildInfo, type WallClock } from "./buildinfo";
import type { HandbuchConfig } from "./config";
import { buildModel, type Model } from "./model";
import { createImagePlan, type ImagePlan, renderPage } from "./render";

const CONVERSION_BATCH = 8;

export type BuildResult = {
  outDir: string;
  stats: Model["stats"];
  imageCount: number;
  totalBytes: number;
};

type Sharp = typeof import("sharp").default;

export const SHARP_MISSING_MESSAGE =
  "sharp is not installed. Install it to build the handbuch (bun add -d sharp).";

// sharp is native and an optional peer: only the build path may load it.
async function loadSharp(): Promise<Sharp> {
  try {
    return (await import("sharp")).default;
  } catch {
    throw new Error(SHARP_MISSING_MESSAGE);
  }
}

async function convertImages(sharp: Sharp, outDir: string, images: ImagePlan): Promise<void> {
  const jobs = [...images.jobs];
  for (let start = 0; start < jobs.length; start += CONVERSION_BATCH) {
    await Promise.all(
      jobs.slice(start, start + CONVERSION_BATCH).map(async ([dest, job]) => {
        const target = join(outDir, dest);
        mkdirSync(dirname(target), { recursive: true });
        await sharp(job.src)
          .flatten({ background: "#ffffff" })
          .resize({ width: job.width, withoutEnlargement: true })
          .webp({ quality: job.quality })
          .toFile(target);
      }),
    );
  }
}

function directorySize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(path) : statSync(path).size;
  }
  return total;
}

export async function buildHandbuch(
  config: HandbuchConfig,
  options: {
    rootDir: string;
    outDir: string;
    shotsDir?: string;
    textsDir?: string;
    flowShotsDir?: string;
    flowTextsDir?: string;
    withLarge?: boolean;
    now?: WallClock;
  },
): Promise<BuildResult> {
  const sharp = await loadSharp();
  const model = await buildModel(config, {
    rootDir: options.rootDir,
    shotsDir: options.shotsDir,
    textsDir: options.textsDir,
    flowShotsDir: options.flowShotsDir,
    flowTextsDir: options.flowTextsDir,
  });
  const images = createImagePlan(options.withLarge ?? true);
  const html = renderPage(
    config.translations?.[config.defaultLocale]?.title ?? config.title,
    model,
    images,
    collectBuildInfo(
      resolve(options.rootDir, config.repo),
      options.now,
      (config.flowSources ?? []).map((source) => resolve(options.rootDir, source.repo)),
      config.defaultLocale,
    ),
  );

  rmSync(options.outDir, { recursive: true, force: true });
  mkdirSync(options.outDir, { recursive: true });
  await convertImages(sharp, options.outDir, images);
  writeFileSync(join(options.outDir, "index.html"), html);

  return {
    outDir: options.outDir,
    stats: model.stats,
    imageCount: images.jobs.size,
    totalBytes: directorySize(options.outDir),
  };
}
