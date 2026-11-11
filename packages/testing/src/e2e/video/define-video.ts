import type { Locator, Page } from "@playwright/test";
import type { PresentIdentity } from "../present-identities";
import type { SeedTenantFixture } from "../seeded-tenant-fixture";

export interface VideoVoice {
  readonly voice: string;
  readonly instructions?: string;
  readonly model?: string;
}

export const DEFAULT_TTS_MODEL = "google/gemini-3.8-flash-tts";

export interface VideoTools {
  moveTo(target: Locator): Promise<void>;
  click(target: Locator): Promise<void>;
  type(target: Locator, text: string): Promise<void>;
  hold(ms: number): Promise<void>;
  // Frames the element until the scene ends; call it after the scene has navigated.
  focus(target: Locator): Promise<void>;
  // PNG data URL of the current app view, with presented identities applied.
  snapshot(): Promise<string>;
  // Replaces the page with a self-contained HTML stage; its CSS animations start at 0 ms.
  stage(html: string): Promise<void>;
  // Steps the stage's CSS animations frame by frame, so the video time is exact.
  animate(ms: number): Promise<void>;
}

export interface VideoSceneContext {
  readonly seedTenant: SeedTenantFixture;
  readonly locale: string;
  // Same contract as ScenarioFixtures.presentIdentities: replaces seeded addresses in every frame.
  readonly presentIdentities: (mappings: readonly PresentIdentity[]) => void;
  readonly tools: VideoTools;
  // Ids created in `setup` that scenes need; scenes of one video share it.
  readonly state: Map<string, unknown>;
  // Length of the current scene's narration; 0 in `setup`. The scene holds at least this long.
  readonly speechMs: number;
}

export interface VideoScene {
  readonly id: string;
  readonly do: (page: Page, ctx: VideoSceneContext) => Promise<void>;
  readonly instructions?: string;
}

export interface VideoMusic {
  // Absolute path to an mp3, wav or m4a; loops under the narration and ducks while it speaks.
  readonly file: string;
  // Default 0.35.
  readonly volume?: number;
}

export const MIN_PLAYBACK_RATE = 0.5;
export const MAX_PLAYBACK_RATE = 2;

export interface VideoDefinition {
  readonly music?: VideoMusic;
  // Speeds picture, narration and subtitles up together, default 1; ffmpeg's atempo allows 0.5 to 2.
  readonly playbackRate?: number;
  readonly voice: VideoVoice;
  readonly viewport?: { readonly width: number; readonly height: number };
  // Login/seed work; runs before recording starts.
  readonly setup?: (page: Page, ctx: VideoSceneContext) => Promise<void>;
  readonly scenes: readonly VideoScene[];
}

export function defineVideo(definition: VideoDefinition): VideoDefinition {
  if (definition.scenes.length === 0) {
    throw new Error("defineVideo(): a video needs at least one scene");
  }
  if (definition.viewport !== undefined) {
    const { width, height } = definition.viewport;
    // libx264 with yuv420p cannot encode odd dimensions.
    if (width % 2 !== 0 || height % 2 !== 0) {
      throw new Error(`defineVideo(): viewport ${width}x${height} must have even width and height`);
    }
  }
  const rate = definition.playbackRate;
  if (rate !== undefined && !(rate >= MIN_PLAYBACK_RATE && rate <= MAX_PLAYBACK_RATE)) {
    throw new Error(
      `defineVideo(): playbackRate ${rate} must be between ${MIN_PLAYBACK_RATE} and ${MAX_PLAYBACK_RATE}`,
    );
  }
  const seen = new Set<string>();
  for (const scene of definition.scenes) {
    if (seen.has(scene.id)) throw new Error(`defineVideo(): duplicate scene id "${scene.id}"`);
    seen.add(scene.id);
  }
  return definition;
}
