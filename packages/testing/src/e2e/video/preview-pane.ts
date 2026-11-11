import { STAGE_ACCENT_COLOR, STAGE_MONO_FONT, STAGE_TEXT_COLOR, stageMs } from "./stage-window";
import type { TypedStage } from "./terminal-stage";

export interface PreviewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StagePreviewCard {
  readonly title: string;
  readonly lines: readonly string[];
}

export interface StagePreview {
  // data: or file URL of an app screenshot, typically tools.snapshot()
  readonly imageUrl: string;
  readonly imageWidthPx: number;
  readonly imageHeightPx: number;
  // App before the typed code, same pixel size as imageUrl. Shown while typing; imageUrl crossfades over it at the focus switch.
  readonly beforeImageUrl?: string;
  // in screenshot pixels, e.g. from locator.boundingBox() taken at the screenshot's viewport
  readonly highlights?: readonly PreviewBox[];
  readonly cards?: readonly StagePreviewCard[];
}

export type PreviewStage = TypedStage & { readonly focusSwitchMs?: number };

export const FOCUS_SWITCH_DELAY_MS = 300;
const FOCUS_TRANSITION_MS = 500;
const HIGHLIGHT_FADE_MS = 400;
const CARD_FIRST_DELAY_MS = 900;
const CARD_STAGGER_MS = 450;
const CARD_FLY_MS = 350;
const PREVIEW_HOLD_MS = 2500;

const HIGHLIGHT_PADDING_PX = 8;

// Elements below the fold report boxes past the screenshot edge.
function paddedWithinImage(box: PreviewBox, width: number, height: number): PreviewBox {
  const x = Math.max(0, box.x - HIGHLIGHT_PADDING_PX);
  const y = Math.max(0, box.y - HIGHLIGHT_PADDING_PX);
  const right = Math.min(width, box.x + box.width + HIGHLIGHT_PADDING_PX);
  const bottom = Math.min(height, box.y + box.height + HIGHLIGHT_PADDING_PX);
  return { x, y, width: right - x, height: bottom - y };
}

const percent = (value: number, total: number): string => `${+((value / total) * 100).toFixed(3)}%`;

interface PreviewParts {
  readonly css: string;
  readonly html: string;
  readonly durationMs: number;
}

export function previewParts(preview: StagePreview, switchMs: number): PreviewParts {
  const { imageWidthPx: width, imageHeightPx: height } = preview;
  const cards = preview.cards ?? [];
  const focusAt = stageMs(switchMs);
  const highlightAt = switchMs + FOCUS_TRANSITION_MS;
  const lastCardStartMs = switchMs + CARD_FIRST_DELAY_MS + (cards.length - 1) * CARD_STAGGER_MS;
  const durationMs = Math.max(
    highlightAt + PREVIEW_HOLD_MS,
    cards.length > 0 ? lastCardStartMs + CARD_FLY_MS + PREVIEW_HOLD_MS : 0,
  );
  const css = `
.window { inset: 5vh 51vw 5vh 3vw; animation: focus-left ${FOCUS_TRANSITION_MS}ms ease-in-out ${focusAt} both; }
.preview { position: absolute; top: 5vh; bottom: 5vh; left: 51vw; right: 3vw; display: flex; align-items: center; justify-content: center; }
.shot { position: relative; width: min(100%, calc(90vh * ${width} / ${height})); aspect-ratio: ${width} / ${height}; opacity: .35; filter: saturate(.6); transform: scale(.97); animation: focus-right ${FOCUS_TRANSITION_MS}ms ease-in-out ${focusAt} both; }
.shot img { width: 100%; height: 100%; display: block; border-radius: 12px; box-shadow: 0 40px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.08); }
.shot img.after { position: absolute; inset: 0; opacity: 0; animation: crossfade-in ${FOCUS_TRANSITION_MS}ms ease-in-out ${focusAt} both; }
.highlight { position: absolute; box-sizing: border-box; border: 3px solid ${STAGE_ACCENT_COLOR}; border-radius: 8px; box-shadow: 0 0 24px rgba(95,215,230,0.55); opacity: 0; }
.cards { position: absolute; bottom: 6vh; left: 2vw; max-width: 60%; display: flex; flex-direction: column; gap: 14px; }
.card { padding: 16px 22px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); border-left: 4px solid ${STAGE_ACCENT_COLOR}; background: rgba(29,31,39,0.95); box-shadow: 0 16px 40px rgba(0,0,0,0.5); opacity: 0; }
.card-title { font: 700 22px ui-sans-serif, system-ui, -apple-system, sans-serif; color: ${STAGE_ACCENT_COLOR}; }
.card-line { margin-top: 6px; font: 18px ${STAGE_MONO_FONT}; color: ${STAGE_TEXT_COLOR}; }
@keyframes focus-left { from { opacity: 1; transform: scale(1); } to { opacity: .45; transform: scale(.97); } }
@keyframes focus-right { from { opacity: .35; filter: saturate(.6); transform: scale(.97); } to { opacity: 1; filter: saturate(1); transform: scale(1); } }
@keyframes crossfade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes highlight-in { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
@keyframes highlight-pulse { 0%, 100% { box-shadow: 0 0 24px rgba(95,215,230,0.55); } 50% { box-shadow: 0 0 44px rgba(95,215,230,0.95); } }
@keyframes card-in { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); } }
`;
  const highlightHtml = (preview.highlights ?? [])
    .map((highlight) => paddedWithinImage(highlight, width, height))
    .map(
      (box) =>
        `<div class="highlight" style="left:${percent(box.x, width)};top:${percent(box.y, height)};width:${percent(box.width, width)};height:${percent(box.height, height)};animation: highlight-in ${HIGHLIGHT_FADE_MS}ms ease-out ${stageMs(highlightAt)} both, highlight-pulse 1200ms ease-in-out ${stageMs(highlightAt + HIGHLIGHT_FADE_MS)} 1 both"></div>`,
    )
    .join("");
  const afterUrl = Bun.escapeHTML(preview.imageUrl);
  const imagesHtml = preview.beforeImageUrl
    ? `<img src="${Bun.escapeHTML(preview.beforeImageUrl)}" alt=""><img class="after" src="${afterUrl}" alt="">`
    : `<img src="${afterUrl}" alt="">`;
  const cardsHtml = cards
    .map((card, index) => {
      const startMs = switchMs + CARD_FIRST_DELAY_MS + index * CARD_STAGGER_MS;
      const lines = card.lines
        .map((line) => `<div class="card-line">${Bun.escapeHTML(line)}</div>`)
        .join("");
      return `<div class="card" style="animation: card-in ${CARD_FLY_MS}ms ease-out ${stageMs(startMs)} both"><div class="card-title">${Bun.escapeHTML(card.title)}</div>${lines}</div>`;
    })
    .join("");
  const html = `<div class="preview"><div class="shot">${imagesHtml}${highlightHtml}</div>${cardsHtml ? `<div class="cards">${cardsHtml}</div>` : ""}</div>`;
  return { css, html, durationMs };
}
