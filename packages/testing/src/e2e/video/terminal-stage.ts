import {
  type EditorPreview,
  type EditorStage,
  FOCUS_SWITCH_DELAY_MS,
  previewParts,
} from "./preview-pane";
import {
  blinkAnimation,
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
  // displayed runtime, e.g. really measured; defaults to the animated duration
  readonly elapsedMs?: number;
  // the command never returns (e.g. a dev server): no meta, no new prompt; only allowed as the last command
  readonly keepsRunning?: boolean;
  // working directory for the lines after this command, e.g. after cd
  readonly promptAfter?: string;
  // pause after the last output line, default 700
  readonly holdMs?: number;
}

export interface TerminalStageOptions {
  readonly commands: readonly TerminalCommand[];
  // working directory shown in the tab, the pane header and the prompt pill, default "~"
  readonly prompt?: string;
  readonly fontSizePx?: number;
  readonly seed?: number;
  // app screenshot on the right; the terminal moves left and focus switches after the last output line
  readonly preview?: EditorPreview;
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

const WINDOW_BACKGROUND = "#0f1923";
const TABBAR_BACKGROUND = "#16202a";
const TAB_BACKGROUND = "#2a343e";
const TAB_BORDER = "#3a444e";
const TAB_TEXT_COLOR = "#c3ccd5";
const TAB_ICON_COLOR = "#9aa5b1";
const TABBAR_CONTROL_COLOR = "#6f7780";
const PATH_PILL_BACKGROUND = "#60b7f7";
const TEXT_COLOR = "#d5dde5";
const COMMAND_COLOR = "#f2f6fa";
const DIM_COLOR = "#7d8a97";
const SANS_FONT = "ui-sans-serif, system-ui, -apple-system, sans-serif";

const TONE_COLORS: Record<StageTone, string> = {
  plain: TEXT_COLOR,
  dim: DIM_COLOR,
  success: "#7bd88f",
  error: "#ff6b6b",
  accent: PATH_PILL_BACKGROUND,
};

const ROBOT_ICON = `<svg class="tab-icon" viewBox="0 0 16 16" fill="none" stroke="${TAB_ICON_COLOR}" stroke-width="1.4" stroke-linecap="round"><rect x="2.5" y="5" width="11" height="8" rx="2"/><path d="M8 5V2.5"/><circle cx="5.8" cy="9" r="0.6" fill="${TAB_ICON_COLOR}"/><circle cx="10.2" cy="9" r="0.6" fill="${TAB_ICON_COLOR}"/></svg>`;

interface PathSegment {
  readonly path: string;
  readonly fromMs: number;
  toMs?: number;
}

function jittered(base: number, spread: number, random: () => number): number {
  return base + (random() * 2 - 1) * spread;
}

const normalizeOutputLine = (line: string | StageOutputLine): Required<StageOutputLine> =>
  typeof line === "string"
    ? { text: line, tone: "plain" }
    : { text: line.text, tone: line.tone ?? "plain" };

const formatDuration = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;

// All paths share one grid cell; each is only visible during its segment.
const pathSwitcherHtml = (segments: readonly PathSegment[]): string =>
  `<span class="paths">${segments
    .map(
      (segment) =>
        `<span style="animation: ${visibleBetweenAnimation(segment.fromMs, segment.toMs)}">${Bun.escapeHTML(segment.path)}</span>`,
    )
    .join("")}</span>`;

export function terminalStage(options: TerminalStageOptions): EditorStage {
  const fontSize = options.fontSizePx ?? 26;
  const lineHeight = Math.round(fontSize * 1.5);
  const titleBarPx = Math.round(fontSize * 1.8);
  const random = seededRandom(options.seed ?? 1);
  if (options.commands.slice(0, -1).some((entry) => entry.keepsRunning)) {
    throw new Error("terminalStage: keepsRunning is only allowed on the last command");
  }
  const segments: PathSegment[] = [{ path: options.prompt ?? "~", fromMs: 0 }];
  let clock = 0;
  let lastOutputMs = 0;
  const keyframeCss: string[] = [];
  const rows: string[] = [];

  const currentPath = (): string => segments[segments.length - 1]?.path ?? "";
  const row = (appearAtMs: number, content: string): string =>
    `<div class="row" style="animation: row-in 1ms steps(1, end) ${stageMs(appearAtMs)} forwards">${content}</div>`;
  const pathPillRow = (appearAtMs: number): string =>
    row(appearAtMs, `<span class="pill">${Bun.escapeHTML(currentPath())}</span>`);

  options.commands.forEach((entry, index) => {
    const lineStart = clock;
    const typeStart = lineStart + jittered(THINK_MS, THINK_JITTER_MS, random);
    const offsets = typingOffsetsMs(entry.command, TERMINAL_RHYTHM, random);
    const keyframes = typedWidthKeyframes(`type-${index}`, offsets);
    keyframeCss.push(keyframes.css);
    const enterAt = typeStart + (offsets.length > 0 ? keyframes.durationMs : 0) + ENTER_DELAY_MS;

    // Wrapping rows reveal per character: a width-clipped box would show the whole text squeezed and re-wrap on every step.
    const typed = options.preview
      ? `<span class="typed-wrap">${Array.from(entry.command)
          .map(
            (char, charIndex) =>
              `<span class="ch" style="animation: char-in 1ms steps(1, end) ${stageMs(typeStart + (offsets[charIndex] ?? 0))} forwards">${Bun.escapeHTML(char)}</span>`,
          )
          .join("")}</span>`
      : `<span class="typed" style="animation: type-${index} ${stageMs(keyframes.durationMs)} linear ${stageMs(typeStart)} forwards">${Bun.escapeHTML(entry.command)}</span>`;
    const cursor = `<span class="cursor" style="animation: ${visibleBetweenAnimation(lineStart, enterAt)}"></span>`;

    let outputAt = enterAt + (entry.busyMs ?? DEFAULT_BUSY_MS);
    const outputRows: string[] = [];
    (entry.output ?? []).forEach((rawLine, lineIndex) => {
      if (lineIndex > 0) outputAt += jittered(OUTPUT_GAP_MS, OUTPUT_GAP_JITTER_MS, random);
      const line = normalizeOutputLine(rawLine);
      outputRows.push(
        row(
          outputAt,
          `<span style="color:${TONE_COLORS[line.tone]}">${Bun.escapeHTML(line.text)}</span>`,
        ),
      );
    });
    const meta = entry.keepsRunning
      ? ""
      : `<span class="meta" style="animation: ${visibleBetweenAnimation(outputAt)}">${formatDuration(entry.elapsedMs ?? outputAt - enterAt)} • exit 0</span>`;

    rows.push(pathPillRow(lineStart));
    rows.push(row(lineStart, `${typed}${cursor}${meta}`));
    rows.push(...outputRows);

    lastOutputMs = outputAt;
    clock = outputAt + (entry.holdMs ?? DEFAULT_HOLD_MS);
    if (entry.promptAfter !== undefined && entry.promptAfter !== currentPath()) {
      const last = segments[segments.length - 1];
      if (last) last.toMs = outputAt;
      segments.push({ path: entry.promptAfter, fromMs: outputAt });
    }
  });

  if (!options.commands[options.commands.length - 1]?.keepsRunning) {
    rows.push(pathPillRow(clock));
    rows.push(
      row(clock, `<span class="cursor" style="animation: ${blinkAnimation(clock)}"></span>`),
    );
  }

  // Rows grow from height 0 instead of toggling display: animations never start on display:none elements.
  const css = `${stageCommonCss}
.window { background: ${WINDOW_BACKGROUND}; color: ${TEXT_COLOR}; }
.titlebar { background: ${TABBAR_BACKGROUND}; border-bottom: none; }
.tabs { display: flex; align-items: center; gap: ${Math.round(fontSize * 0.5)}px; margin-left: 130px; height: 100%; font-family: ${SANS_FONT}; font-size: ${Math.round(titleBarPx * 0.38)}px; }
.tab { display: flex; align-items: center; gap: 10px; box-sizing: border-box; width: ${Math.round(fontSize * 12)}px; height: 72%; padding: 0 14px; border-radius: 9px; background: ${TAB_BACKGROUND}; border: 1px solid ${TAB_BORDER}; color: ${TAB_TEXT_COLOR}; overflow: hidden; white-space: nowrap; }
.tab-icon { flex: none; width: 1.2em; height: 1.2em; }
.tab .paths { flex: 1 1 0; min-width: 0; text-align: center; }
.tab-control { color: ${TABBAR_CONTROL_COLOR}; font-size: 1.3em; line-height: 1; }
.paths { display: grid; }
.paths > span { grid-area: 1 / 1; text-align: center; opacity: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pane-header { flex: none; display: flex; justify-content: center; padding-top: ${Math.round(fontSize * 0.3)}px; font-size: ${Math.round(fontSize * 0.7)}px; line-height: ${Math.round(fontSize * 1.1)}px; color: ${DIM_COLOR}; }
@keyframes row-in { from { height: 0; } to { height: ${lineHeight}px; } }
${keyframeCss.join("\n")}
.body { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; }
.lines { min-height: 100%; flex-shrink: 0; box-sizing: border-box; padding: ${Math.round(fontSize * 0.6)}px ${Math.round(fontSize * 0.5)}px; font-size: ${fontSize}px; line-height: ${lineHeight}px; }
.row { height: 0; overflow: hidden; white-space: pre; }
.pill { display: inline-block; padding: 0 ${Math.round(fontSize * 0.3)}px; border-radius: 5px; background: ${PATH_PILL_BACKGROUND}; color: ${WINDOW_BACKGROUND}; line-height: ${Math.round(fontSize * 1.3)}px; }
.typed { display: inline-block; overflow: hidden; vertical-align: bottom; width: 0; color: ${COMMAND_COLOR}; font-weight: 700; }
.cursor { display: inline-block; width: 0.6em; height: ${Math.round(fontSize * 1.15)}px; vertical-align: bottom; background: ${COMMAND_COLOR}; opacity: 0; }
.meta { margin-left: 1.2em; font-size: 0.72em; color: ${DIM_COLOR}; opacity: 0; white-space: nowrap; }
`;
  const switchMs = lastOutputMs + FOCUS_SWITCH_DELAY_MS;
  const previewPart = options.preview ? previewParts(options.preview, switchMs) : undefined;
  // The narrower window keeps the font size, so long lines wrap. Rows grow to their content up to a cap instead of a fixed height.
  const wrapCss = previewPart
    ? `
.row { height: auto; max-height: 0; white-space: pre-wrap; word-break: break-all; }
@keyframes row-in { from { max-height: 0; } to { max-height: ${lineHeight * 8}px; } }
@keyframes char-in { from { width: 0; } to { width: 1ch; } }
.typed-wrap { color: ${COMMAND_COLOR}; font-weight: 700; }
.ch { display: inline-block; width: 0; overflow: hidden; vertical-align: bottom; }
.meta { float: right; margin-left: 1.2em; }
`
    : "";
  const titlebar = `<div class="tabs"><div class="tab">${ROBOT_ICON}${pathSwitcherHtml(segments)}</div><span class="tab-control">+</span><span class="tab-control">⌄</span></div>`;
  const body = `<div class="pane-header">${pathSwitcherHtml(segments)}</div><div class="body"><div class="lines">${rows.join("")}</div></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}${wrapCss}${previewPart?.css ?? ""}</style></head><body>${windowFrame(titlebar, body, titleBarPx)}${previewPart?.html ?? ""}</body></html>`;
  if (!previewPart) return { html, durationMs: clock + FINAL_BLINK_MS };
  return { html, durationMs: previewPart.durationMs, focusSwitchMs: switchMs };
}
