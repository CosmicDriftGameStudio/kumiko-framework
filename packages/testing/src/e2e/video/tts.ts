import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TTS_MODEL, type VideoVoice } from "./define-video";

const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;
const SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
const ERROR_BODY_CHARS = 300;

export function pcmDurationMs(byteLength: number, sampleRate = SAMPLE_RATE): number {
  return Math.round((byteLength / BYTES_PER_SAMPLE / sampleRate) * 1000);
}

export function pcmToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const wav = new Uint8Array(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(wav.buffer);
  const writeTag = (offset: number, tag: string): void => {
    for (let i = 0; i < tag.length; i++) view.setUint8(offset + i, tag.charCodeAt(i));
  };
  writeTag(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  wav.set(pcm, WAV_HEADER_BYTES);
  return wav;
}

export interface SynthesizeSpeechOptions {
  readonly text: string;
  readonly voice: VideoVoice;
  readonly sceneInstructions?: string;
  readonly cacheDir: string;
  readonly apiKey: string | undefined;
  readonly fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface SynthesizedSpeech {
  readonly wavPath: string;
  readonly durationMs: number;
}

export async function synthesizeSpeech(
  options: SynthesizeSpeechOptions,
): Promise<SynthesizedSpeech> {
  const { text, voice, cacheDir, apiKey, fetchImpl = fetch } = options;
  const model = voice.model ?? DEFAULT_TTS_MODEL;
  const instructions = options.sceneInstructions ?? voice.instructions;
  const hash = createHash("sha256")
    .update(JSON.stringify({ model, voice: voice.voice, instructions: instructions ?? null, text }))
    .digest("hex");
  const wavPath = join(cacheDir, `${hash}.wav`);
  if (existsSync(wavPath)) {
    return { wavPath, durationMs: pcmDurationMs(statSync(wavPath).size - WAV_HEADER_BYTES) };
  }

  if (apiKey === undefined || apiKey === "") throw new Error("OPENROUTER_API_KEY is missing");
  // Gemini TTS only serves raw PCM (mp3 answers 400); instructions stay out of
  // `input` because the model would read them aloud.
  const response = await fetchImpl(SPEECH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: text,
      voice: voice.voice,
      response_format: "pcm",
      ...(instructions !== undefined && { instructions }),
    }),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, ERROR_BODY_CHARS);
    throw new Error(`TTS request failed with status ${response.status}: ${body}`);
  }
  const pcm = new Uint8Array(await response.arrayBuffer());
  if (pcm.byteLength === 0 || pcm.byteLength % BYTES_PER_SAMPLE !== 0) {
    throw new Error(`TTS answer is not valid s16le PCM (${pcm.byteLength} bytes)`);
  }
  mkdirSync(cacheDir, { recursive: true });
  // Atomic write: a killed run must not leave a truncated wav that later counts as a cache hit.
  const tempPath = `${wavPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, pcmToWav(pcm));
  renameSync(tempPath, wavPath);
  return { wavPath, durationMs: pcmDurationMs(pcm.byteLength) };
}
