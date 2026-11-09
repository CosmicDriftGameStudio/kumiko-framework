import type { VideoTools } from "./define-video";

export const SCENE_TAIL_MS = 400;

export function sceneExtensionMs(elapsedMs: number, speechMs: number): number {
  return Math.max(0, speechMs + SCENE_TAIL_MS - elapsedMs);
}

export function assertAiNoticeCoversLocales(
  aiNotice: Readonly<Record<string, string>> | undefined,
  locales: readonly string[],
): void {
  if (aiNotice === undefined) return;
  for (const locale of locales) {
    if (aiNotice[locale] === undefined) {
      throw new Error(`runVideos(): aiNotice has no text for locale "${locale}"`);
    }
  }
}

// Frames taken during `setup` would land at the start of the MP4 (login typing, passwords).
function unavailableInSetup(): never {
  throw new Error("Video tools are not available in setup (nothing is recorded yet); use page");
}

export const SETUP_TOOLS: VideoTools = {
  moveTo: unavailableInSetup,
  click: unavailableInSetup,
  type: unavailableInSetup,
  hold: unavailableInSetup,
  focus: unavailableInSetup,
  snapshot: unavailableInSetup,
  stage: unavailableInSetup,
  animate: unavailableInSetup,
};
