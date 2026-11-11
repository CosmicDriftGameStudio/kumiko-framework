import type { Page } from "@playwright/test";

export interface FocusBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface VideoOverlayApi {
  move(x: number, y: number): void;
  ripple(x: number, y: number): void;
  clearRipples(): void;
  focus(box: FocusBox | null): void;
}

declare global {
  interface Window {
    __kumikoVideoOverlay?: VideoOverlayApi;
  }
}

// Runs in the browser, so it may not reference module scope.
export function installVideoOverlay(): void {
  const POSITION_KEY = "kumiko:video-cursor";
  const ACCENT = "#6366f1";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const TOP = "2147483647";

  const layer = document.createElement("div");
  layer.id = "kumiko-video-overlay";
  layer.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${TOP};`;

  const cursor = document.createElementNS(SVG_NS, "svg");
  cursor.setAttribute("width", "24");
  cursor.setAttribute("height", "24");
  cursor.setAttribute("viewBox", "0 0 24 24");
  cursor.style.cssText =
    "position:absolute;left:0;top:0;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45));";
  const arrow = document.createElementNS(SVG_NS, "path");
  arrow.setAttribute("d", "M3 2 L3 19 L7.5 14.8 L10.6 21.5 L13.2 20.3 L10.1 13.7 L16.5 13.7 Z");
  arrow.setAttribute("fill", "#ffffff");
  arrow.setAttribute("stroke", "#111111");
  arrow.setAttribute("stroke-width", "1.4");
  arrow.setAttribute("stroke-linejoin", "round");
  cursor.appendChild(arrow);

  const focusFrame = document.createElement("div");
  focusFrame.style.cssText = `position:absolute;display:none;pointer-events:none;box-sizing:border-box;border:3px solid ${ACCENT};border-radius:10px;box-shadow:0 0 0 4px ${ACCENT}33,0 0 24px ${ACCENT}88;`;

  layer.append(focusFrame, cursor);

  // Init scripts run before the document has elements, so the layer is mounted on first use.
  const mount = (): void => {
    if (!layer.isConnected) document.body.appendChild(layer);
  };

  const placeCursor = (x: number, y: number): void => {
    mount();
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    try {
      sessionStorage.setItem(POSITION_KEY, JSON.stringify({ x, y }));
    } catch {
      // Storage may be blocked; the cursor then restarts at the origin.
    }
  };

  const api: VideoOverlayApi = {
    move: placeCursor,
    ripple: (x, y) => {
      mount();
      const ripple = document.createElement("div");
      ripple.style.cssText = `position:absolute;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;pointer-events:none;background:${ACCENT}55;border:3px solid ${ACCENT};`;
      ripple.dataset["kumikoRipple"] = "1";
      layer.appendChild(ripple);
    },
    clearRipples: () => {
      for (const ripple of layer.querySelectorAll("[data-kumiko-ripple]")) ripple.remove();
    },
    focus: (box) => {
      mount();
      if (box === null) {
        focusFrame.style.display = "none";
        return;
      }
      const pad = 6;
      focusFrame.style.display = "block";
      focusFrame.style.left = `${box.x - pad}px`;
      focusFrame.style.top = `${box.y - pad}px`;
      focusFrame.style.width = `${box.width + pad * 2}px`;
      focusFrame.style.height = `${box.height + pad * 2}px`;
    },
  };
  window.__kumikoVideoOverlay = api;

  let restored = { x: 0, y: 0 };
  try {
    const raw = sessionStorage.getItem(POSITION_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "x" in parsed &&
        "y" in parsed &&
        typeof parsed.x === "number" &&
        typeof parsed.y === "number"
      ) {
        restored = { x: parsed.x, y: parsed.y };
      }
    }
  } catch {
    // Unreadable stored position: start at the origin.
  }
  cursor.style.transform = `translate(${restored.x}px, ${restored.y}px)`;
  // A page without interaction still shows the cursor where the last page left it.
  document.addEventListener("DOMContentLoaded", mount);
}

export async function addVideoOverlay(page: Page): Promise<void> {
  await page.addInitScript(installVideoOverlay);
}

export async function moveCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([cx, cy]) => window.__kumikoVideoOverlay?.move(cx, cy), [x, y] as const);
}

export async function rippleAt(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([cx, cy]) => window.__kumikoVideoOverlay?.ripple(cx, cy), [x, y] as const);
}

export async function clearRipples(page: Page): Promise<void> {
  await page.evaluate(() => window.__kumikoVideoOverlay?.clearRipples());
}

export async function showFocus(page: Page, box: FocusBox | null): Promise<void> {
  await page.evaluate((target) => window.__kumikoVideoOverlay?.focus(target), box);
}
