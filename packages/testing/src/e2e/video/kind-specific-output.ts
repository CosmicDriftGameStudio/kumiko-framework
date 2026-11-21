import { rmSync, writeFileSync } from "node:fs";
import { buildVtt, type VttCue, writePoster } from "./mux";

// Silent lead-in held on the first scene frame; a frame from before the first scene shows whatever setup left on the page.
export const LEAD_IN_MS = 500;

// The lead-in only gives the first narration a beat before it starts; a silent loop would freeze on it.
export function leadInMs(silent: boolean): number {
  return silent ? 0 : LEAD_IN_MS;
}

export interface KindSpecificFileInput {
  readonly silent: boolean;
  readonly outMp4: string;
  readonly vttPath: string;
  readonly posterPath: string;
  readonly cues: readonly VttCue[];
  readonly playbackRate: number | undefined;
}

// Subtitles from an earlier voiced run must not linger next to a silent video. A voiced
// video keeps its `<locale>.jpg`: that poster is placed by hand and uploaded with the video.
export function writeKindSpecificFile(
  input: KindSpecificFileInput,
  makePoster: (mp4: string, posterPath: string) => void = writePoster,
): void {
  const { silent, outMp4, vttPath, posterPath, cues, playbackRate } = input;
  if (!silent) {
    writeFileSync(vttPath, buildVtt(cues, playbackRate));
    return;
  }
  rmSync(vttPath, { force: true });
  makePoster(outMp4, posterPath);
}
