import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { VideoMusic } from "./define-video";

export const VIDEO_FPS = 30;

export interface MuxFrame {
  readonly path: string;
  readonly durationMs: number;
}

export interface VttCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface MuxSceneAudio {
  readonly wavPath: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly sceneMs: number;
}

function concatFileLine(path: string): string {
  return `file '${path.replaceAll("'", "'\\''")}'`;
}

export function buildFrameConcatList(frames: readonly MuxFrame[]): string {
  const last = frames.at(-1);
  if (last === undefined) throw new Error("buildFrameConcatList(): no frames");
  // Rounding cumulative boundaries instead of each duration keeps the sum equal to the total.
  let elapsedMs = 0;
  let previousBoundaryUs = 0;
  const lines = frames.flatMap((frame) => {
    elapsedMs += frame.durationMs;
    const boundaryUs = Math.round(elapsedMs * 1000);
    const durationUs = boundaryUs - previousBoundaryUs;
    previousBoundaryUs = boundaryUs;
    return [concatFileLine(frame.path), `duration ${(durationUs / 1_000_000).toFixed(6)}`];
  });
  // The concat demuxer ignores the duration of the final entry unless that file is listed again.
  lines.push(concatFileLine(last.path));
  return `${lines.join("\n")}\n`;
}

function formatVttTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const pad = (value: number, width: number): string => String(value).padStart(width, "0");
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(total % 1000, 3)}`;
}

// A blank line ends a cue and "-->" starts a timing line, so neither may reach the cue text.
function vttCueText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll("-->", "--&gt;")
    .replace(/\n\s*\n/g, "\n");
}

export function buildVtt(cues: readonly VttCue[]): string {
  const blocks = cues.map(
    (cue) =>
      `${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}\n${vttCueText(cue.text)}`,
  );
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

// Per scene: delay the narration to its start, then pad with silence to the
// scene's end so audio and picture stay aligned across scenes.
export function buildAudioFilter(
  sceneAudio: readonly MuxSceneAudio[],
  firstInputIndex: number,
  outputLabel = "aout",
): string {
  let previousEndMs = 0;
  const chains = sceneAudio.map((scene, index) => {
    const leadMs = Math.max(0, scene.startMs - previousEndMs);
    const wholeSeconds = ((leadMs + scene.sceneMs) / 1000).toFixed(4);
    previousEndMs = scene.startMs + scene.sceneMs;
    const delay = leadMs > 0 ? `adelay=${leadMs}:all=1,` : "";
    return `[${firstInputIndex + index}:a]${delay}apad=whole_dur=${wholeSeconds},atrim=0:${wholeSeconds}[a${index}]`;
  });
  const joined = sceneAudio.map((_, index) => `[a${index}]`).join("");
  return `${chains.join(";")};${joined}concat=n=${sceneAudio.length}:v=0:a=1[${outputLabel}]`;
}

export const DEFAULT_MUSIC_VOLUME = 0.35;
const MUSIC_FADE_OUT_SECONDS = 2;

// Music loops under the narration and is ducked by it via sidechain compression.
export function buildMusicMixFilter(
  musicInputIndex: number,
  volume: number,
  videoMs: number,
): string {
  const videoSeconds = videoMs / 1000;
  const fadeStart = Math.max(0, videoSeconds - MUSIC_FADE_OUT_SECONDS).toFixed(4);
  return [
    "[voice]asplit=2[voiceMix][voiceSc]",
    `[${musicInputIndex}:a]aloop=loop=-1:size=2e9,atrim=0:${videoSeconds.toFixed(4)},volume=${volume},afade=t=out:st=${fadeStart}:d=${MUSIC_FADE_OUT_SECONDS}[music]`,
    "[music][voiceSc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked]",
    "[voiceMix][ducked]amix=inputs=2:duration=first:normalize=0[aout]",
  ].join(";");
}

// Video lives in filter_complex too: -vf cannot be mixed with -filter_complex.
export function buildVideoFilter(brandInputIndex: number | undefined): string {
  if (brandInputIndex === undefined) return `[0:v]fps=${VIDEO_FPS}[vout]`;
  return `[0:v]fps=${VIDEO_FPS}[base];[base][${brandInputIndex}:v]overlay=W-w-40:H-h-40[vout]`;
}

export interface MuxVideoOptions {
  readonly music?: VideoMusic;
  readonly metadataComment?: string;
  readonly brandPng?: string;
  readonly frames: readonly MuxFrame[];
  readonly sceneAudio: readonly MuxSceneAudio[];
  readonly outMp4: string;
  readonly workDir: string;
}

export function muxVideo(options: MuxVideoOptions): void {
  const { frames, outMp4, workDir } = options;
  mkdirSync(workDir, { recursive: true });
  mkdirSync(dirname(outMp4), { recursive: true });
  const listPath = join(workDir, "frames.txt");
  writeFileSync(listPath, buildFrameConcatList(frames));
  // A player that has the old file open loses its audio when ffmpeg truncates it in place;
  // the rename swaps in the new file while the player keeps reading the old one.
  const partialMp4 = `${outMp4}.partial.mp4`;
  const args = buildMuxArgs({ ...options, outMp4: partialMp4 }, listPath);
  execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  renameSync(partialMp4, outMp4);
}

export function buildMuxArgs(options: MuxVideoOptions, listPath: string): string[] {
  const { frames, sceneAudio, outMp4, brandPng, music, metadataComment } = options;
  const audioInputs = sceneAudio.flatMap((scene) => ["-i", scene.wavPath]);
  const musicInputIndex = music === undefined ? undefined : 1 + sceneAudio.length;
  const brandInputIndex =
    brandPng === undefined ? undefined : 1 + sceneAudio.length + (music === undefined ? 0 : 1);
  const audioFilter =
    music === undefined || musicInputIndex === undefined
      ? buildAudioFilter(sceneAudio, 1)
      : `${buildAudioFilter(sceneAudio, 1, "voice")};${buildMusicMixFilter(
          musicInputIndex,
          music.volume ?? DEFAULT_MUSIC_VOLUME,
          frames.reduce((total, frame) => total + frame.durationMs, 0),
        )}`;
  return [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    ...audioInputs,
    ...(music === undefined ? [] : ["-i", music.file]),
    ...(brandPng === undefined ? [] : ["-i", brandPng]),
    "-filter_complex",
    `${buildVideoFilter(brandInputIndex)};${audioFilter}`,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    // CRF 28 halves the size of animated stages at no visible loss; faststart puts the
    // index up front so a browser starts playing before the download ends.
    "-preset",
    "slow",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    ...(metadataComment === undefined ? [] : ["-metadata", `comment=${metadataComment}`]),
    outMp4,
  ];
}
