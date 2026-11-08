import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod";
import type { VideoDefinition } from "./define-video";

const textsSchema = z.record(z.string(), z.string().min(1));

export function videoTextsPath(videoDir: string, locale: string): string {
  return join(videoDir, `text.${locale}.yaml`);
}

export function loadVideoTexts(videoDir: string, locale: string): Readonly<Record<string, string>> {
  const path = videoTextsPath(videoDir, locale);
  if (!existsSync(path)) throw new Error(`Video texts file missing: ${path}`);
  // Bun API is safe here: Playwright runs as `bunx --bun playwright` (scaffold standard).
  const parsed = textsSchema.safeParse(Bun.YAML.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(
      `Video texts invalid in ${path} (expected scene id -> non-empty text): ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export function findVideoTextGaps(
  video: Pick<VideoDefinition, "scenes">,
  videoDir: string,
  locales: readonly string[],
): string[] {
  const gaps: string[] = [];
  const sceneIds = new Set(video.scenes.map((scene) => scene.id));
  for (const locale of locales) {
    const path = videoTextsPath(videoDir, locale);
    if (!existsSync(path)) {
      gaps.push(`${locale}: texts file missing (${path})`);
      continue;
    }
    const texts = loadVideoTexts(videoDir, locale);
    for (const id of sceneIds) {
      if (texts[id] === undefined) gaps.push(`${locale}: scene "${id}" has no text`);
    }
    for (const id of Object.keys(texts)) {
      if (!sceneIds.has(id)) gaps.push(`${locale}: text "${id}" has no scene`);
    }
  }
  return gaps;
}
