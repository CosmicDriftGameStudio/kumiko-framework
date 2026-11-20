import type { VideoDefinition, VideoScene } from "./define-video";
import { type SynthesizedSpeech, type SynthesizeSpeechOptions, synthesizeSpeech } from "./tts";
import { loadVideoTexts } from "./video-texts";

export interface SceneNarration {
  readonly text: string;
  readonly speech: SynthesizedSpeech;
}

export interface Narrator {
  narrate(scene: VideoScene): Promise<SceneNarration>;
}

export interface NarratorOptions {
  readonly video: Pick<VideoDefinition, "voice">;
  readonly videoId: string;
  readonly videoDir: string;
  readonly locale: string;
  readonly ttsCacheDir: string;
  readonly apiKey: string | undefined;
  readonly loadTexts?: typeof loadVideoTexts;
  readonly synthesize?: (options: SynthesizeSpeechOptions) => Promise<SynthesizedSpeech>;
}

// Undefined for a silent video: it reads no text file and never reaches TTS.
export function createNarrator(options: NarratorOptions): Narrator | undefined {
  const { video, videoId, videoDir, locale, ttsCacheDir, apiKey } = options;
  const { voice } = video;
  if (voice === undefined) return undefined;
  const texts = (options.loadTexts ?? loadVideoTexts)(videoDir, locale);
  const synthesize = options.synthesize ?? synthesizeSpeech;
  return {
    async narrate(scene) {
      const text = texts[scene.id];
      if (text === undefined) {
        throw new Error(`Video "${videoId}" [${locale}]: scene "${scene.id}" has no text`);
      }
      const speech = await synthesize({
        text,
        voice,
        ...(scene.instructions !== undefined && { sceneInstructions: scene.instructions }),
        cacheDir: ttsCacheDir,
        apiKey,
      });
      return { text, speech };
    },
  };
}
