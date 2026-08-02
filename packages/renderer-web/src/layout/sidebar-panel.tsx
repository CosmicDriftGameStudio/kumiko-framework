// A second sidebar column for screens that need a list next to the navigation
// rather than inside the content — the shadcn `sidebar-09` pattern (mail
// client) against the `sidebar-07` the shell otherwise runs.
//
// Why a slot and not a screen layout: the area sits outside the `SidebarInset`
// and therefore above the ShellHeader. A screen renders by definition *into*
// the content, below the header, and cannot reach that spot from there. The
// slot inverts the direction: the shell holds the space, the screen fills it
// through a portal and stays an ordinary screen otherwise.
//
// With no screen filling it the shell does not render the space at all — no
// empty strip on every other screen.

import {
  createContext,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

type SlotElement = HTMLElement | null;

type SidebarPanelSlot = {
  readonly element: SlotElement;
  /** Tells the shell state whether a screen is currently claiming the space. */
  readonly setOccupied: (occupied: boolean) => void;
};

const SidebarPanelContext = createContext<SidebarPanelSlot | null>(null);

export const SidebarPanelProvider = SidebarPanelContext.Provider;

/** Shells only — screens use `SidebarPanel`. */
export function useSidebarPanelSlot(): SidebarPanelSlot | null {
  return useContext(SidebarPanelContext);
}

export type SidebarPanelProps = {
  readonly children: ReactNode;
  /** Initial width in px. After the first drag the stored width wins. */
  readonly defaultWidth?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  /** localStorage key for the dragged width. Without a key nothing is stored —
   *  two screens with their own list should not overwrite each other's width. */
  readonly storageKey?: string;
  readonly className?: string;
};

const DEFAULT_WIDTH = 340;
const DEFAULT_MIN = 260;
const DEFAULT_MAX = 640;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readStoredWidth(key: string | undefined): number | null {
  if (key === undefined || typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Renders its children into the second sidebar column when the shell offers
 *  one. When it does not (public surface, tests, an older shell) the children
 *  land in place — the screen stays usable instead of losing its list.
 *
 *  The width drags like in any mail client: the handle sits on the divider and
 *  the result survives a reload (with `storageKey`). */
export function SidebarPanel({
  children,
  defaultWidth = DEFAULT_WIDTH,
  minWidth = DEFAULT_MIN,
  maxWidth = DEFAULT_MAX,
  storageKey,
  className,
}: SidebarPanelProps): ReactNode {
  const slot = useSidebarPanelSlot();
  const setOccupied = slot?.setOccupied;
  const [width, setWidth] = useState<number>(() =>
    clamp(readStoredWidth(storageKey) ?? defaultWidth, minWidth, maxWidth),
  );
  const dragging = useRef(false);

  useEffect(() => {
    if (setOccupied === undefined) return;
    setOccupied(true);
    return () => setOccupied(false);
  }, [setOccupied]);

  // Listeners on window, not on the handle: a fast drag leaves the 4px strip
  // between two frames, and a handler on the element would lose the drag there.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      event.preventDefault();
      setWidth(clamp(event.clientX, minWidth, maxWidth));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [minWidth, maxWidth]);

  useEffect(() => {
    if (storageKey === undefined || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    // Set globally while dragging: otherwise the cursor flickers as soon as the
    // pointer sits over the list instead of the handle, and a drag selects the
    // row text on the way.
    document.body.style.setProperty("cursor", "col-resize");
    document.body.style.setProperty("user-select", "none");
  }, []);

  const content = (
    <div
      data-kumiko-layout="sidebar-panel-body"
      className={cn(
        "relative flex h-full shrink-0 flex-col border-sidebar-border border-r bg-sidebar",
        className,
      )}
      style={{ width: `${width}px` }}
    >
      {children}
      {/* biome-ignore lint/a11y/useKeyWithMouseEvents: the width itself is the keyboard equivalent — it is optional, the content stays fully reachable without dragging. */}
      <div
        data-kumiko-layout="sidebar-panel-handle"
        onPointerDown={startDrag}
        className="absolute inset-y-0 right-0 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-sidebar-border"
      />
    </div>
  );

  if (slot?.element == null) {
    return content;
  }
  return createPortal(content, slot.element);
}

/** Shell-side counterpart: holds the slot element and the occupied state. Its
 *  own hook so both shells (WorkspaceShell, DefaultAppShell) share one wiring
 *  instead of getting the same thing half right twice. */
export function useSidebarPanelHost(): {
  readonly occupied: boolean;
  readonly value: SidebarPanelSlot;
  readonly ref: (node: SlotElement) => void;
} {
  const [element, setElement] = useState<SlotElement>(null);
  const [occupied, setOccupied] = useState(false);
  return {
    occupied,
    value: { element, setOccupied },
    ref: setElement,
  };
}
