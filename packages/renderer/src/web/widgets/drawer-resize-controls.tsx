import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import type { ReactNode } from "react";
import type { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import type { DrawerResizeHandle, DrawerResizeState } from "./use-drawer-resize.ts";

export type DrawerResizeControlsModel = {
  readonly t: ReturnType<typeof useTranslation>;
  readonly side: "left" | "right" | "top" | "bottom";
  readonly resize: DrawerResizeState;
  readonly handle: DrawerResizeHandle;
};

export function renderMaximizeButton(model: DrawerResizeControlsModel): ReactNode {
  const { t, resize } = model;
  const { maximized, setMaximized } = resize;
  return (
    <button
      type="button"
      onClick={() => setMaximized((m) => !m)}
      aria-pressed={maximized}
      aria-label={
        maximized ? t("kumiko.widget.drawer.restore") : t("kumiko.widget.drawer.maximize")
      }
      className="absolute top-4 right-14 z-10 rounded-xs p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
    >
      {maximized ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
    </button>
  );
}

export function renderResizeHandle(model: DrawerResizeControlsModel): ReactNode {
  const { t, side, resize, handle } = model;
  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> can't carry pointer/keyboard drag interaction or a live width value — a draggable separator needs a div with the ARIA role.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("kumiko.widget.drawer.resize")}
      aria-valuenow={resize.effectiveWidthPx}
      aria-valuemin={resize.minWidthPx}
      aria-valuemax={resize.effectiveMaxWidthPx()}
      tabIndex={0}
      {...handle.handleDrag}
      onKeyDown={handle.onHandleKeyDown}
      className={cn(
        "absolute inset-y-0 z-10 w-1 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 hover:bg-border",
        side === "right" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
      )}
    />
  );
}
