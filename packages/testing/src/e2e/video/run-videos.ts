import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Page } from "@playwright/test";
import { DESKTOP_VIEWPORT } from "../constants";
import type { PresentIdentity } from "../present-identities";
import { assertPresentableMappings } from "../present-identities";
import { resolveLocaleTag, trackInFlightRequests } from "../screenshots";
import { test } from "../seeded-tenant-fixture";
import { addVideoOverlay, showFocus } from "./cursor-overlay";
import type { VideoDefinition, VideoSceneContext } from "./define-video";
import { FrameTimeline } from "./frame-timeline";
import { buildVtt, type MuxSceneAudio, muxVideo, type VttCue } from "./mux";
import { assertAiNoticeCoversLocales, SETUP_TOOLS, sceneExtensionMs } from "./scene-plan";
import { synthesizeSpeech } from "./tts";
import { loadVideoTexts } from "./video-texts";

const INTRO_MS = 500;

export interface RunVideosOptions {
  readonly videos: Readonly<Record<string, VideoDefinition>>;
  readonly videosDir: string;
  readonly locales: readonly string[];
  /** Absolute path to an SVG or PNG, overlaid bottom right on every video. */
  readonly brandLogo?: string;
  // Locale to disclosure text ("AI voice"); shown next to the logo and written to the MP4 comment.
  readonly aiNotice?: Readonly<Record<string, string>>;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const BRAND_MIME: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

async function renderBrandPng(
  page: Page,
  logoPath: string,
  outPng: string,
  notice: string | undefined,
): Promise<void> {
  const mime = BRAND_MIME[extname(logoPath).toLowerCase()];
  if (mime === undefined) throw new Error(`brandLogo "${logoPath}": use a .svg or .png file`);
  const dataUrl = `data:${mime};base64,${readFileSync(logoPath).toString("base64")}`;
  const noticeHtml =
    notice === undefined
      ? ""
      : `<span style="width:1px;height:28px;background:rgba(31,59,92,0.25)"></span><span style="font:18px system-ui,-apple-system,'Segoe UI',sans-serif;color:rgba(31,59,92,0.75);white-space:nowrap">${escapeHtml(notice)}</span>`;
  await page.setContent(
    `<body style="margin:0;background:transparent"><div id="brand" style="display:inline-flex;align-items:center;gap:16px;margin:20px;padding:12px 20px;border-radius:16px;background:rgba(246,244,239,0.9);box-shadow:0 2px 8px rgba(0,0,0,0.18)"><img src="${escapeHtml(dataUrl)}" style="display:block;height:40px">${noticeHtml}</div></body>`,
  );
  await page.locator("#brand").screenshot({ path: outPng, omitBackground: true });
}

function csvFilter(raw: string | undefined): ReadonlySet<string> | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  );
}

// Registrar like runMatrix: call at the spec's module top, do NOT await.
export function runVideos(options: RunVideosOptions): void {
  const { videos, videosDir, locales, brandLogo, aiNotice } = options;
  const onlyIds = csvFilter(process.env["VIDEO_ONLY"]);
  const onlyLocales = csvFilter(process.env["VIDEO_LOCALES"]);
  const ttsCacheDir = join(videosDir, ".cache", "tts");

  assertAiNoticeCoversLocales(aiNotice, locales);

  for (const [id, video] of Object.entries(videos)) {
    if (onlyIds !== undefined && !onlyIds.has(id)) continue;
    for (const locale of locales) {
      if (onlyLocales !== undefined && !onlyLocales.has(locale)) continue;
      test.describe(locale, () => {
        test.use({ locale: resolveLocaleTag(locale, undefined) });
        test(`${id} [${locale}]`, async ({ page, seedTenant }, testInfo) => {
          const videoDir = join(videosDir, id);
          const texts = loadVideoTexts(videoDir, locale);
          await page.setViewportSize(video.viewport ?? DESKTOP_VIEWPORT);
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.addInitScript((lng) => {
            localStorage.setItem("kumiko:locale", lng);
          }, locale);
          await addVideoOverlay(page);
          // Count requests fired by `setup` in the first settle().
          trackInFlightRequests(page);

          const identities: PresentIdentity[] = [];
          const timeline = new FrameTimeline(page, testInfo.outputPath("frames"), identities);
          const ctx: VideoSceneContext = {
            seedTenant,
            locale,
            tools: timeline.tools,
            state: new Map(),
            speechMs: 0,
            presentIdentities: (mappings) => {
              assertPresentableMappings(mappings);
              identities.push(...mappings);
            },
          };
          await video.setup?.(page, { ...ctx, tools: SETUP_TOOLS });

          await timeline.settle();
          await timeline.capture(INTRO_MS);

          const sceneAudio: MuxSceneAudio[] = [];
          const cues: VttCue[] = [];
          for (const scene of video.scenes) {
            const text = texts[scene.id];
            if (text === undefined)
              throw new Error(`Video "${id}" [${locale}]: scene "${scene.id}" has no text`);
            const speech = await synthesizeSpeech({
              text,
              voice: video.voice,
              ...(scene.instructions !== undefined && { sceneInstructions: scene.instructions }),
              cacheDir: ttsCacheDir,
              apiKey: process.env["OPENROUTER_API_KEY"],
            });

            // Narration starts at the scene start, so the intro frame stays silent.
            const startMs = timeline.totalMs;
            await scene.do(page, { ...ctx, speechMs: speech.durationMs });
            const extensionMs = sceneExtensionMs(timeline.totalMs - startMs, speech.durationMs);
            if (extensionMs > 0) {
              // A fresh frame, not a stretched old one: the scene may end on an uncaptured action.
              await timeline.settle();
              await timeline.capture(extensionMs);
            }
            await showFocus(page, null);

            const sceneMs = timeline.totalMs - startMs;
            sceneAudio.push({
              wavPath: speech.wavPath,
              startMs,
              durationMs: speech.durationMs,
              sceneMs,
            });
            cues.push({ startMs, endMs: startMs + sceneMs, text });
          }

          const outDir = join(videoDir, "out");
          mkdirSync(outDir, { recursive: true });
          const outMp4 = join(outDir, `${locale}.mp4`);
          const notice = aiNotice?.[locale];
          const muxDir = testInfo.outputPath("mux");
          mkdirSync(muxDir, { recursive: true });
          let brandPng: string | undefined;
          if (brandLogo !== undefined) {
            brandPng = join(muxDir, "brand.png");
            await renderBrandPng(page, brandLogo, brandPng, notice);
          }
          muxVideo({
            ...(brandPng !== undefined && { brandPng }),
            ...(notice !== undefined && { metadataComment: notice }),
            ...(video.music !== undefined && { music: video.music }),
            frames: timeline.allFrames,
            sceneAudio,
            outMp4,
            workDir: muxDir,
          });
          writeFileSync(join(outDir, `${locale}.vtt`), buildVtt(cues));
        });
      });
    }
  }
}
