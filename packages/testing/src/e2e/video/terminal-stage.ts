import {
  blinkAnimation,
  STAGE_ACCENT_COLOR,
  STAGE_TEXT_COLOR,
  stageCommonCss,
  stageMs,
  visibleBetweenAnimation,
  windowFrame,
} from "./stage-window";
import { seededRandom, typedWidthKeyframes, typingOffsetsMs } from "./typing";

export type StageTone = "plain" | "dim" | "success" | "error" | "accent";

export interface StageOutputLine {
  readonly text: string;
  readonly tone?: StageTone;
}

export interface TerminalCommand {
  readonly command: string;
  readonly output?: readonly (string | StageOutputLine)[];
  // simulated work between Enter and the first output line, default 250
  readonly busyMs?: number;
  // prompt for the lines after this command, e.g. after cd
  readonly promptAfter?: string;
  // pause after the last output line, default 700
  readonly holdMs?: number;
}

export interface TerminalStageOptions {
  readonly commands: readonly TerminalCommand[];
  readonly title?: string;
  readonly prompt?: string;
  readonly fontSizePx?: number;
  readonly seed?: number;
}

export interface TypedStage {
  readonly html: string;
  readonly durationMs: number;
}

const TERMINAL_RHYTHM = { charMs: 70, jitterMs: 35, spaceExtraMs: 90 } as const;
const THINK_MS = 450;
const THINK_JITTER_MS = 150;
const ENTER_DELAY_MS = 250;
const OUTPUT_GAP_MS = 35;
const OUTPUT_GAP_JITTER_MS = 12;
const DEFAULT_BUSY_MS = 250;
const DEFAULT_HOLD_MS = 700;
const FINAL_BLINK_MS = 1200;

const TONE_COLORS: Record<StageTone, string> = {
  plain: STAGE_TEXT_COLOR,
  dim: "#7c8290",
  success: "#7ee787",
  error: "#ff7b72",
  accent: STAGE_ACCENT_COLOR,
};

function jittered(base: number, spread: number, random: () => number): number {
  return base + (random() * 2 - 1) * spread;
}

const normalizeOutputLine = (line: string | StageOutputLine): Required<StageOutputLine> =>
  typeof line === "string"
    ? { text: line, tone: "plain" }
    : { text: line.text, tone: line.tone ?? "plain" };

export function terminalStage(options: TerminalStageOptions): TypedStage {
  const fontSize = options.fontSizePx ?? 26;
  const lineHeight = Math.round(fontSize * 1.5);
  const random = seededRandom(options.seed ?? 1);
  let prompt = options.prompt ?? "~ $";
  let clock = 0;
  const keyframeCss: string[] = [];
  const rows: string[] = [];

  const row = (appearAtMs: number, content: string): string =>
    `<div class="row" style="animation: row-in 1ms steps(1, end) ${stageMs(appearAtMs)} forwards">${content}</div>`;
  const promptHtml = (): string =>
    `<span style="color:${STAGE_ACCENT_COLOR}">${Bun.escapeHTML(prompt)}</span> `;

  options.commands.forEach((entry, index) => {
    const lineStart = clock;
    const typeStart = lineStart + jittered(THINK_MS, THINK_JITTER_MS, random);
    const offsets = typingOffsetsMs(entry.command, TERMINAL_RHYTHM, random);
    const keyframes = typedWidthKeyframes(`type-${index}`, offsets);
    keyframeCss.push(keyframes.css);
    const enterAt = typeStart + (offsets.length > 0 ? keyframes.durationMs : 0) + ENTER_DELAY_MS;

    const typed = `<span class="typed" style="animation: type-${index} ${stageMs(keyframes.durationMs)} linear ${stageMs(typeStart)} forwards">${Bun.escapeHTML(entry.command)}</span>`;
    const cursor = `<span class="cursor" style="animation: ${visibleBetweenAnimation(lineStart, enterAt)}"></span>`;
    rows.push(row(lineStart, `${promptHtml()}${typed}${cursor}`));

    let outputAt = enterAt + (entry.busyMs ?? DEFAULT_BUSY_MS);
    (entry.output ?? []).forEach((rawLine, lineIndex) => {
      if (lineIndex > 0) outputAt += jittered(OUTPUT_GAP_MS, OUTPUT_GAP_JITTER_MS, random);
      const line = normalizeOutputLine(rawLine);
      rows.push(
        row(
          outputAt,
          `<span style="color:${TONE_COLORS[line.tone]}">${Bun.escapeHTML(line.text)}</span>`,
        ),
      );
    });
    clock = outputAt + (entry.holdMs ?? DEFAULT_HOLD_MS);
    if (entry.promptAfter !== undefined) prompt = entry.promptAfter;
  });

  rows.push(
    row(
      clock,
      `${promptHtml()}<span class="cursor" style="animation: ${blinkAnimation(clock)}"></span>`,
    ),
  );

  // Rows grow from height 0 instead of toggling display: animations never start on display:none elements.
  const css = `${stageCommonCss}
@keyframes row-in { from { height: 0; } to { height: ${lineHeight}px; } }
${keyframeCss.join("\n")}
.body { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; }
.lines { min-height: 100%; flex-shrink: 0; box-sizing: border-box; padding: ${Math.round(fontSize * 0.9)}px ${Math.round(fontSize * 1.1)}px; font-size: ${fontSize}px; line-height: ${lineHeight}px; }
.row { height: 0; overflow: hidden; white-space: pre; }
.typed { display: inline-block; overflow: hidden; vertical-align: bottom; width: 0; }
.cursor { display: inline-block; width: 0.6em; height: ${Math.round(fontSize * 1.15)}px; vertical-align: bottom; background: ${STAGE_TEXT_COLOR}; opacity: 0; }
`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${windowFrame(
    Bun.escapeHTML(options.title ?? "zsh"),
    `<div class="body"><div class="lines">${rows.join("")}</div></div>`,
    Math.round(fontSize * 1.8),
  )}</body></html>`;
  return { html, durationMs: clock + FINAL_BLINK_MS };
}
