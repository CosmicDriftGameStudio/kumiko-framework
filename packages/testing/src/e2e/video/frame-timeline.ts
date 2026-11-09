import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { type PresentIdentity, withPresentedIdentities } from "../present-identities";
import { trackInFlightRequests, waitForSettledPage } from "../screenshots";
import { clearRipples, moveCursor, rippleAt, showFocus } from "./cursor-overlay";
import type { VideoTools } from "./define-video";
import { VIDEO_FPS } from "./mux";

export const FRAME_MS = 1000 / VIDEO_FPS;
const MOVE_STEPS = 15;
const RIPPLE_FRAMES = 6;
const TYPE_FRAME_MS = 60;

export interface TimelineFrame {
  readonly path: string;
  durationMs: number;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// Virtual time: the page is never recorded live. Each screenshot is a frame
// with an assigned duration, so slow captures do not stretch the video.
export class FrameTimeline {
  private readonly frames: TimelineFrame[] = [];
  private cursor = { x: 0, y: 0 };
  private stageClockMs = 0;

  constructor(
    private readonly page: Page,
    private readonly frameDir: string,
    private readonly identities: readonly PresentIdentity[] = [],
  ) {
    mkdirSync(frameDir, { recursive: true });
  }

  get allFrames(): readonly TimelineFrame[] {
    return this.frames;
  }

  get totalMs(): number {
    return this.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  }

  async capture(durationMs: number, animations: "disabled" | "allow" = "disabled"): Promise<void> {
    const path = join(
      this.frameDir,
      `frame-${String(this.frames.length + 1).padStart(5, "0")}.png`,
    );
    await withPresentedIdentities(this.page, this.identities, () =>
      this.page.screenshot({ path, animations }),
    );
    this.frames.push({ path, durationMs });
  }

  async settle(): Promise<void> {
    await waitForSettledPage(this.page, trackInFlightRequests(this.page));
  }

  private async centerOf(target: Locator): Promise<{ x: number; y: number }> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (box === null) throw new Error("Video tools: target element has no bounding box");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  private async glideTo(destination: { x: number; y: number }): Promise<void> {
    const from = this.cursor;
    for (let step = 1; step <= MOVE_STEPS; step++) {
      const t = easeInOut(step / MOVE_STEPS);
      const x = from.x + (destination.x - from.x) * t;
      const y = from.y + (destination.y - from.y) * t;
      await moveCursor(this.page, x, y);
      await this.capture(FRAME_MS);
    }
    this.cursor = destination;
  }

  readonly tools: VideoTools = {
    moveTo: async (target) => {
      await this.glideTo(await this.centerOf(target));
    },
    click: async (target) => {
      await this.tools.moveTo(target);
      await rippleAt(this.page, this.cursor.x, this.cursor.y);
      for (let frame = 0; frame < RIPPLE_FRAMES; frame++) await this.capture(FRAME_MS);
      await clearRipples(this.page);
      await target.click();
      await this.settle();
      await this.capture(FRAME_MS);
    },
    type: async (target, text) => {
      await this.tools.click(target);
      for (const char of text) {
        await target.pressSequentially(char);
        await this.capture(TYPE_FRAME_MS);
      }
    },
    hold: async (ms) => {
      await this.capture(ms);
    },
    snapshot: async () => {
      const png = await withPresentedIdentities(this.page, this.identities, () =>
        this.page.screenshot({ animations: "disabled" }),
      );
      return `data:image/png;base64,${png.toString("base64")}`;
    },
    stage: async (html) => {
      await this.page.setContent(html, { waitUntil: "load" });
      this.stageClockMs = 0;
    },
    animate: async (ms) => {
      const frames = Math.max(1, Math.round(ms / FRAME_MS));
      for (let frame = 0; frame < frames; frame++) {
        await this.page.evaluate((clockMs) => {
          for (const animation of document.getAnimations()) {
            animation.pause();
            animation.currentTime = clockMs;
          }
        }, this.stageClockMs);
        // "disabled" would fast-forward the paused animations to their end state.
        await this.capture(FRAME_MS, "allow");
        this.stageClockMs += FRAME_MS;
      }
    },
    focus: async (target) => {
      await this.settle();
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (box === null) throw new Error("Video tools: target element has no bounding box");
      await showFocus(this.page, box);
      await this.capture(FRAME_MS);
    },
  };
}
