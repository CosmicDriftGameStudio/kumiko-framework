import {
  blinkAnimation,
  STAGE_TEXT_COLOR,
  STAGE_WINDOW_BACKGROUND,
  stageCommonCss,
  stageMs,
  visibleBetweenAnimation,
  windowFrame,
} from "./stage-window";
import type { TypedStage } from "./terminal-stage";
import { seededRandom, typedWidthKeyframes, typingOffsetsMs } from "./typing";

export type EditorLine = string | { readonly typed: string };

export interface EditorStageOptions {
  // tab label, e.g. "src/features/event/feature.ts"
  readonly fileName: string;
  readonly lines: readonly EditorLine[];
  readonly firstLineNumber?: number;
  readonly startDelayMs?: number;
  readonly fontSizePx?: number;
  readonly seed?: number;
}

const EDITOR_RHYTHM = { charMs: 28, jitterMs: 14, spaceExtraMs: 20 } as const;
const LINE_PAUSE_MS = 200;
const END_HOLD_MS = 1500;

type TokenKind = "comment" | "string" | "number" | "keyword" | "function" | "type" | "plain";

const TOKEN_COLORS: Record<TokenKind, string> = {
  comment: "#6b7280",
  string: "#a5d6a7",
  number: "#f0b27a",
  keyword: "#c792ea",
  function: "#82aaff",
  type: "#ffcb6b",
  plain: STAGE_TEXT_COLOR,
};

const KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "const",
  "let",
  "function",
  "return",
  "async",
  "await",
  "if",
  "else",
  "new",
  "type",
  "interface",
  "true",
  "false",
  "null",
  "undefined",
  "as",
  "satisfies",
  "readonly",
  "typeof",
  "keyof",
  "extends",
  "void",
  "as",
  "satisfies",
  "readonly",
  "typeof",
  "keyof",
  "extends",
  "void",
]);

const TOKEN_PATTERN =
  /(\/\/.*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([\s\S])/gy;

function identifierKind(name: string, followedByParen: boolean): TokenKind {
  if (KEYWORDS.has(name)) return "keyword";
  if (followedByParen) return "function";
  if (/^[A-Z]/.test(name)) return "type";
  return "plain";
}

function highlightTypeScript(code: string): string {
  const parts: string[] = [];
  const emit = (kind: TokenKind, text: string): void => {
    const escaped = Bun.escapeHTML(text);
    parts.push(
      kind === "plain" ? escaped : `<span style="color:${TOKEN_COLORS[kind]}">${escaped}</span>`,
    );
  };
  for (const match of code.matchAll(TOKEN_PATTERN)) {
    const [text, comment, string, number, identifier] = match;
    if (comment !== undefined) emit("comment", comment);
    else if (string !== undefined) emit("string", string);
    else if (number !== undefined) emit("number", number);
    else if (identifier !== undefined) {
      const next = code[(match.index ?? 0) + identifier.length];
      emit(identifierKind(identifier, next === "(" || next === "<"), identifier);
    } else emit("plain", text);
  }
  return parts.join("");
}

export function editorStage(options: EditorStageOptions): TypedStage {
  const fontSize = options.fontSizePx ?? 24;
  const lineHeight = Math.round(fontSize * 1.6);
  const firstNumber = options.firstLineNumber ?? 1;
  const random = seededRandom(options.seed ?? 1);
  const lastTypedIndex = options.lines.findLastIndex((line) => typeof line !== "string");
  const gutterChars = String(firstNumber + options.lines.length - 1).length;
  const keyframeCss: string[] = [];
  let clock = options.startDelayMs ?? 600;
  let typingEndMs = clock;

  const rows = options.lines.map((line, index) => {
    const number = `<span class="gutter">${firstNumber + index}</span>`;
    if (typeof line === "string") {
      return `<div class="line">${number}<span class="code">${highlightTypeScript(line)}</span></div>`;
    }
    const indent = line.typed.match(/^\s*/)?.[0] ?? "";
    const rest = line.typed.slice(indent.length);
    const offsets = typingOffsetsMs(rest, EDITOR_RHYTHM, random);
    if (offsets.length === 0) {
      return `<div class="line">${number}<span class="code">${Bun.escapeHTML(indent)}</span></div>`;
    }
    const keyframes = typedWidthKeyframes(`type-${index}`, offsets);
    keyframeCss.push(keyframes.css);
    const startMs = clock;
    const endMs = startMs + keyframes.durationMs;
    clock = endMs + LINE_PAUSE_MS;
    typingEndMs = endMs;
    const cursorAnimation =
      index === lastTypedIndex
        ? `${visibleBetweenAnimation(startMs)}, ${blinkAnimation(endMs)}`
        : visibleBetweenAnimation(startMs, endMs);
    const highlight = `<span class="active-line" style="animation: ${visibleBetweenAnimation(startMs, endMs)}"></span>`;
    const typed = `<span class="typed" style="animation: type-${index} ${stageMs(keyframes.durationMs)} linear ${stageMs(startMs)} forwards">${highlightTypeScript(rest)}</span>`;
    const cursor = `<span class="caret" style="animation: ${cursorAnimation}"></span>`;
    return `<div class="line">${highlight}${number}<span class="code"><span class="indent">${Bun.escapeHTML(indent)}</span>${typed}${cursor}</span></div>`;
  });

  const css = `${stageCommonCss}
${keyframeCss.join("\n")}
.tabs { flex: none; display: flex; background: #23252e; height: ${Math.round(fontSize * 1.9)}px; font-size: ${Math.round(fontSize * 0.7)}px; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
.tab { display: flex; align-items: center; padding: 0 ${Math.round(fontSize * 1.1)}px; background: ${STAGE_WINDOW_BACKGROUND}; color: ${STAGE_TEXT_COLOR}; border-top: 2px solid #5fd7e6; }
.editor { flex: 1 1 0; min-height: 0; overflow: hidden; padding: ${Math.round(fontSize * 0.7)}px 0; font-size: ${fontSize}px; line-height: ${lineHeight}px; }
.line { position: relative; display: flex; height: ${lineHeight}px; white-space: pre; }
.gutter { flex: none; width: ${gutterChars}ch; box-sizing: content-box; padding: 0 ${Math.round(fontSize * 1.2)}px; text-align: right; color: #4b5263; }
.code { position: relative; }
.active-line { position: absolute; inset: 0; background: rgba(255,255,255,0.05); opacity: 0; }
.typed { display: inline-block; overflow: hidden; vertical-align: bottom; width: 0; }
.caret { display: inline-block; width: 3px; height: ${Math.round(fontSize * 1.25)}px; vertical-align: bottom; background: ${STAGE_TEXT_COLOR}; opacity: 0; }
`;
  const titleBarPx = Math.round(fontSize * 1.8);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${windowFrame(
    "",
    `<div class="tabs"><div class="tab">${Bun.escapeHTML(options.fileName)}</div></div><div class="editor">${rows.join("")}</div>`,
    titleBarPx,
  )}</body></html>`;
  return { html, durationMs: typingEndMs + END_HOLD_MS };
}
