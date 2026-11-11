export interface TypingRhythm {
  readonly charMs: number;
  readonly jitterMs: number;
  readonly spaceExtraMs: number;
}

const MIN_KEYSTROKE_MS = 25;

// mulberry32: tiny seeded PRNG so a video renders identically on every run.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function typingOffsetsMs(
  text: string,
  rhythm: TypingRhythm,
  random: () => number,
): number[] {
  const offsets: number[] = [];
  let clock = 0;
  for (const char of Array.from(text)) {
    const jitter = (random() * 2 - 1) * rhythm.jitterMs;
    clock += Math.max(MIN_KEYSTROKE_MS, rhythm.charMs + jitter);
    offsets.push(clock);
    if (char === " ") clock += rhythm.spaceExtraMs;
  }
  return offsets;
}

export function typedWidthKeyframes(
  name: string,
  offsetsMs: readonly number[],
): { css: string; durationMs: number } {
  const durationMs = offsetsMs[offsetsMs.length - 1];
  if (durationMs === undefined) {
    return { css: `@keyframes ${name} { from { width: 0ch; } to { width: 0ch; } }`, durationMs: 1 };
  }
  // steps(1, end) holds each width until the next keystroke instead of tweening between them.
  const hold = "animation-timing-function: steps(1, end);";
  const frames = [`0% { width: 0ch; ${hold} }`];
  offsetsMs.forEach((offset, index) => {
    const at =
      index === offsetsMs.length - 1 ? "100%" : `${((offset / durationMs) * 100).toFixed(4)}%`;
    frames.push(`${at} { width: ${index + 1}ch; ${hold} }`);
  });
  return { css: `@keyframes ${name} { ${frames.join(" ")} }`, durationMs };
}
