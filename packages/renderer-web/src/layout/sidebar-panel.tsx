// Zweite Sidebar-Spalte fuer Screens, die eine Liste neben der Navigation
// brauchen statt im Content — das shadcn-Muster `sidebar-09` (Mail-Client)
// gegenueber dem `sidebar-07`, das die Shell sonst faehrt.
//
// Warum ein Slot und kein Screen-Layout: der Bereich liegt ausserhalb des
// `SidebarInset` und damit oberhalb des ShellHeader. Ein Screen rendert aber
// per Definition *in* den Content, unter dem Header — von dort kommt er nicht
// an diese Stelle. Der Slot dreht die Richtung um: die Shell haelt den Platz,
// der Screen fuellt ihn per Portal und bleibt sonst ein normaler Screen.
//
// Ohne fuellenden Screen rendert die Shell den Platz nicht — kein leerer
// Streifen auf jedem anderen Screen.

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
  /** Meldet dem Shell-State, ob gerade ein Screen den Platz beansprucht. */
  readonly setOccupied: (occupied: boolean) => void;
};

const SidebarPanelContext = createContext<SidebarPanelSlot | null>(null);

export const SidebarPanelProvider = SidebarPanelContext.Provider;

/** Nur fuer die Shells — Screens nutzen `SidebarPanel`. */
export function useSidebarPanelSlot(): SidebarPanelSlot | null {
  return useContext(SidebarPanelContext);
}

export type SidebarPanelProps = {
  readonly children: ReactNode;
  /** Startbreite in px. Nach dem ersten Ziehen gilt die gespeicherte Breite. */
  readonly defaultWidth?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  /** localStorage-Key fuer die gezogene Breite. Ohne Key wird nicht
   *  gespeichert — zwei Screens mit eigener Liste sollen sich nicht
   *  gegenseitig die Breite ueberschreiben. */
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

/** Rendert seine Kinder in die zweite Sidebar-Spalte, wenn die Shell eine
 *  anbietet. Tut sie das nicht (Public-Surface, Tests, aeltere Shell), landen
 *  die Kinder an Ort und Stelle — der Screen bleibt benutzbar, statt seine
 *  Liste zu verlieren.
 *
 *  Die Breite ist ziehbar wie in jedem Mail-Programm: der Griff sitzt auf der
 *  Trennlinie, das Ergebnis ueberlebt einen Reload (mit `storageKey`). */
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

  // Listener auf window, nicht auf dem Griff: wer schnell zieht, verlaesst den
  // 4px-Streifen zwischen zwei Frames, und ein Handler am Element haette den
  // Zug dann verloren.
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
    // Waehrend des Ziehens global setzen: sonst flackert der Cursor, sobald
    // der Zeiger ueber der Liste statt ueber dem Griff steht, und ein Zug
    // markiert nebenbei den Text der Zeilen.
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
      {/* biome-ignore lint/a11y/useKeyWithMouseEvents: Tastatur-Aequivalent ist die Breite selbst — sie ist optional, der Inhalt bleibt ohne Ziehen vollstaendig erreichbar. */}
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

/** Shell-seitiges Gegenstueck: haelt das Slot-Element und den Belegt-Zustand.
 *  Eigener Hook, damit beide Shells (WorkspaceShell, DefaultAppShell) dieselbe
 *  Verdrahtung teilen und nicht zweimal dasselbe halb richtig machen. */
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
