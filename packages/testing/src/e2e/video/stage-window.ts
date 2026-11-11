export const STAGE_MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
export const STAGE_TEXT_COLOR = "#d7dae0";
export const STAGE_WINDOW_BACKGROUND = "#1d1f27";
export const STAGE_ACCENT_COLOR = "#5fd7e6";
const BLINK_PERIOD_MS = 1060;

export const stageMs = (value: number): string => `${Math.round(value)}ms`;

export const stageCommonCss = `
html, body { margin: 0; width: 100vw; height: 100vh; overflow: hidden; background: radial-gradient(ellipse at 30% 20%, #2b2f3d 0%, #14151b 70%); }
.window { position: absolute; inset: 5vh 5vw; display: flex; flex-direction: column; border-radius: 18px; overflow: hidden; background: ${STAGE_WINDOW_BACKGROUND}; box-shadow: 0 40px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.08); font-family: ${STAGE_MONO_FONT}; color: ${STAGE_TEXT_COLOR}; }
.titlebar { flex: none; position: relative; display: flex; align-items: center; background: #2a2d37; border-bottom: 1px solid rgba(0,0,0,0.4); }
.dots { position: absolute; left: 22px; display: flex; gap: 12px; }
.dot { width: 18px; height: 18px; border-radius: 50%; }
.title { width: 100%; text-align: center; color: #9aa0ad; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
@keyframes on { from { opacity: 0; } to { opacity: 1; } }
@keyframes off { from { opacity: 1; } to { opacity: 0; } }
@keyframes blink { 0% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 1; } }
`;

export function windowFrame(titleHtml: string, bodyHtml: string, titleBarPx: number): string {
  return `<div class="window"><div class="titlebar" style="height:${titleBarPx}px"><div class="dots"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span></div><div class="title" style="font-size:${Math.round(titleBarPx * 0.42)}px">${titleHtml}</div></div>${bodyHtml}</div>`;
}

// Visible from fromMs until toMs (forever when omitted); both edges are 1ms steps.
export function visibleBetweenAnimation(fromMs: number, toMs?: number): string {
  const on = `on 1ms steps(1) ${stageMs(fromMs)} both`;
  return toMs === undefined ? on : `${on}, off 1ms steps(1) ${stageMs(toMs)} forwards`;
}

export function blinkAnimation(delayMs: number): string {
  return `blink ${BLINK_PERIOD_MS}ms steps(1) ${stageMs(delayMs)} infinite`;
}
