import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { GripVerticalIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { clamp } from "../lib/clamp.js";
import { cn } from "../lib/cn.js";
import { useIsNarrowViewport } from "../primitives/use-narrow-viewport.js";
import { arrowKeyDelta, type DragDelta, usePointerDrag } from "./use-pointer-drag.js";

export type FloatingPanelGeometry = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type FloatingPanelProps = {
  /** Header content; the header is the move handle. */
  readonly title: ReactNode;
  /** Header buttons (dock, minimize, close). Pointer-down on interactive
   *  elements does not start a drag. */
  readonly headerActions?: ReactNode;
  readonly children: ReactNode;
  /** localStorage key; without it the geometry isn't persisted. */
  readonly storageKey?: string;
  /** Default 400x560, bottom-right with a 24px margin. */
  readonly defaultGeometry?: Partial<FloatingPanelGeometry>;
  readonly minWidthPx?: number;
  readonly minHeightPx?: number;
  /** Default: viewport width minus twice the margin. */
  readonly maxWidthPx?: number;
  /** Default: viewport height minus twice the margin. */
  readonly maxHeightPx?: number;
  readonly testId?: string;
};

const MARGIN_PX = 24;
const DEFAULT_WIDTH_PX = 400;
const DEFAULT_HEIGHT_PX = 560;
const DEFAULT_MIN_WIDTH_PX = 280;
const DEFAULT_MIN_HEIGHT_PX = 200;

type Edge = "top" | "right" | "bottom" | "left";

const EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];

const EDGE_HANDLE_BASE = "absolute z-10 touch-none hover:bg-border focus-visible:bg-ring";
const CORNER_HANDLE_BASE = "absolute z-20 size-3 touch-none";

const EDGE_HANDLE_CLASS: Readonly<Record<Edge, string>> = {
  top: cn(EDGE_HANDLE_BASE, "inset-x-3 top-0 h-1.5 cursor-ns-resize"),
  bottom: cn(EDGE_HANDLE_BASE, "inset-x-3 bottom-0 h-1.5 cursor-ns-resize"),
  left: cn(EDGE_HANDLE_BASE, "inset-y-3 left-0 w-1.5 cursor-ew-resize"),
  right: cn(EDGE_HANDLE_BASE, "inset-y-3 right-0 w-1.5 cursor-ew-resize"),
};

const CORNER_HANDLES: readonly {
  readonly edges: readonly [Edge, Edge];
  readonly className: string;
}[] = [
  { edges: ["top", "left"], className: cn(CORNER_HANDLE_BASE, "top-0 left-0 cursor-nwse-resize") },
  {
    edges: ["top", "right"],
    className: cn(CORNER_HANDLE_BASE, "top-0 right-0 cursor-nesw-resize"),
  },
  {
    edges: ["bottom", "left"],
    className: cn(CORNER_HANDLE_BASE, "bottom-0 left-0 cursor-nesw-resize"),
  },
  {
    edges: ["bottom", "right"],
    className: cn(CORNER_HANDLE_BASE, "right-0 bottom-0 cursor-nwse-resize"),
  },
];

const EDGE_LABEL_KEYS = {
  top: "kumiko.widget.floatingPanel.resizeTop",
  right: "kumiko.widget.floatingPanel.resizeRight",
  bottom: "kumiko.widget.floatingPanel.resizeBottom",
  left: "kumiko.widget.floatingPanel.resizeLeft",
} as const satisfies Record<Edge, string>;

const INTERACTIVE_HEADER_TARGET = "button, a, input, select, textarea, [role=button]";

type Limits = {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
};

type LimitOptions = {
  readonly minWidthPx?: number | undefined;
  readonly minHeightPx?: number | undefined;
  readonly maxWidthPx?: number | undefined;
  readonly maxHeightPx?: number | undefined;
};

function readLimits(options: LimitOptions): Limits {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.min(options.maxWidthPx ?? viewportWidth - 2 * MARGIN_PX, viewportWidth);
  const maxHeight = Math.min(options.maxHeightPx ?? viewportHeight - 2 * MARGIN_PX, viewportHeight);
  return {
    // A viewport smaller than the configured minimum wins: the panel must stay fully visible.
    minWidth: Math.min(options.minWidthPx ?? DEFAULT_MIN_WIDTH_PX, maxWidth),
    minHeight: Math.min(options.minHeightPx ?? DEFAULT_MIN_HEIGHT_PX, maxHeight),
    maxWidth,
    maxHeight,
    viewportWidth,
    viewportHeight,
  };
}

// Size first, then position, so a shrunk panel is placed against its final size.
function fitGeometry(geometry: FloatingPanelGeometry, limits: Limits): FloatingPanelGeometry {
  const width = clamp(geometry.width, limits.minWidth, limits.maxWidth);
  const height = clamp(geometry.height, limits.minHeight, limits.maxHeight);
  return {
    width,
    height,
    x: clamp(geometry.x, 0, Math.max(0, limits.viewportWidth - width)),
    y: clamp(geometry.y, 0, Math.max(0, limits.viewportHeight - height)),
  };
}

type Axis = { readonly position: number; readonly size: number };

// The edge being dragged follows the pointer; the opposite edge stays put.
function resizeAxis(
  start: Axis,
  delta: number,
  movesStartEdge: boolean,
  min: number,
  max: number,
  viewportSize: number,
): Axis {
  if (movesStartEdge) {
    const end = start.position + start.size;
    const size = clamp(start.size - delta, min, Math.min(max, end));
    return { position: end - size, size };
  }
  const size = clamp(start.size + delta, min, Math.min(max, viewportSize - start.position));
  return { position: start.position, size };
}

function resizeGeometry(
  start: FloatingPanelGeometry,
  edges: readonly Edge[],
  delta: DragDelta,
  limits: Limits,
): FloatingPanelGeometry {
  let { x, y, width, height } = start;
  for (const edge of edges) {
    if (edge === "left" || edge === "right") {
      ({ position: x, size: width } = resizeAxis(
        { position: start.x, size: start.width },
        delta.dx,
        edge === "left",
        limits.minWidth,
        limits.maxWidth,
        limits.viewportWidth,
      ));
    } else {
      ({ position: y, size: height } = resizeAxis(
        { position: start.y, size: start.height },
        delta.dy,
        edge === "top",
        limits.minHeight,
        limits.maxHeight,
        limits.viewportHeight,
      ));
    }
  }
  return { x, y, width, height };
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isFloatingPanelGeometry(value: unknown): value is FloatingPanelGeometry {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    isFiniteNumber(value.x) &&
    "y" in value &&
    isFiniteNumber(value.y) &&
    "width" in value &&
    isFiniteNumber(value.width) &&
    "height" in value &&
    isFiniteNumber(value.height)
  );
}

function readStoredGeometry(storageKey: string | undefined): FloatingPanelGeometry | undefined {
  if (storageKey === undefined) return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isFloatingPanelGeometry(parsed) ? parsed : undefined;
  } catch {
    // Unavailable or corrupt storage just means the default geometry is used.
    return undefined;
  }
}

function writeStoredGeometry(
  storageKey: string | undefined,
  geometry: FloatingPanelGeometry,
): void {
  if (storageKey === undefined) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(geometry));
  } catch {
    // Private mode or quota: the position is simply not remembered.
  }
}

function initialGeometry(
  storageKey: string | undefined,
  defaults: Partial<FloatingPanelGeometry> | undefined,
  limits: Limits,
): FloatingPanelGeometry {
  const stored = readStoredGeometry(storageKey);
  if (stored !== undefined) return fitGeometry(stored, limits);
  const width = defaults?.width ?? DEFAULT_WIDTH_PX;
  const height = defaults?.height ?? DEFAULT_HEIGHT_PX;
  return fitGeometry(
    {
      width,
      height,
      x: defaults?.x ?? limits.viewportWidth - width - MARGIN_PX,
      y: defaults?.y ?? limits.viewportHeight - height - MARGIN_PX,
    },
    limits,
  );
}

/** Non-modal panel floating above the page: draggable by its header,
 *  resizable from all edges and corners, clamped to the viewport, geometry
 *  optionally remembered. On narrow viewports it becomes a full-screen sheet. */
export function FloatingPanel({
  title,
  headerActions,
  children,
  storageKey,
  defaultGeometry,
  minWidthPx,
  minHeightPx,
  maxWidthPx,
  maxHeightPx,
  testId,
}: FloatingPanelProps): ReactNode {
  const t = useTranslation();
  const narrow = useIsNarrowViewport();
  const titleId = useId();
  const getLimits = (): Limits => readLimits({ minWidthPx, minHeightPx, maxWidthPx, maxHeightPx });
  const getLimitsRef = useRef(getLimits);
  getLimitsRef.current = getLimits;

  const [geometry, setGeometry] = useState<FloatingPanelGeometry>(() =>
    initialGeometry(storageKey, defaultGeometry, getLimits()),
  );
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

  const applyGeometry = useCallback((next: FloatingPanelGeometry): void => {
    geometryRef.current = next;
    setGeometry(next);
  }, []);
  const persistGeometry = (): void => writeStoredGeometry(storageKey, geometryRef.current);

  useEffect(() => {
    if (narrow) return;
    const onWindowResize = (): void => {
      applyGeometry(fitGeometry(geometryRef.current, getLimitsRef.current()));
    };
    // Resize events fired while narrow were ignored, so re-fit once on the way back to wide.
    onWindowResize();
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [narrow, applyGeometry]);

  const moveDrag = usePointerDrag({
    onStart: () => geometryRef.current,
    onMove: (start, { dx, dy }) =>
      applyGeometry(fitGeometry({ ...start, x: start.x + dx, y: start.y + dy }, getLimits())),
    onEnd: persistGeometry,
  });
  const onHeaderPointerDown = (event: PointerEvent<HTMLElement>): void => {
    // React events from portalled children (menus) bubble through the header although their DOM is elsewhere.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_HEADER_TARGET)) return;
    moveDrag.onPointerDown(event);
  };
  const onGripKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const delta = arrowKeyDelta(event);
    if (delta === undefined) return;
    event.preventDefault();
    const current = geometryRef.current;
    applyGeometry(
      fitGeometry({ ...current, x: current.x + delta.dx, y: current.y + delta.dy }, getLimits()),
    );
    persistGeometry();
  };

  if (typeof document === "undefined") return null;

  if (narrow) {
    return createPortal(
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        data-testid={testId}
        className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <div id={titleId} className="min-w-0 flex-1 truncate font-medium">
            {title}
          </div>
          {headerActions}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>,
      document.body,
    );
  }

  const limits = getLimits();
  const handleContext: ResizeHandleContext = {
    geometryRef,
    getLimits,
    applyGeometry,
    persistGeometry,
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid={testId}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-2xl"
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
      }}
    >
      <div
        {...moveDrag}
        onPointerDown={onHeaderPointerDown}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b bg-muted px-3 py-2 active:cursor-grabbing"
      >
        <button
          type="button"
          aria-label={t("kumiko.widget.floatingPanel.move")}
          onKeyDown={onGripKeyDown}
          className="rounded-xs p-1 text-muted-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          <GripVerticalIcon className="size-4" />
        </button>
        <div id={titleId} className="min-w-0 flex-1 truncate font-medium">
          {title}
        </div>
        {headerActions}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      {EDGES.map((edge) => (
        <PanelResizeHandle
          key={edge}
          edges={[edge]}
          className={EDGE_HANDLE_CLASS[edge]}
          context={handleContext}
          separator={{ label: t(EDGE_LABEL_KEYS[edge]), geometry, limits }}
        />
      ))}
      {CORNER_HANDLES.map((corner) => (
        <PanelResizeHandle
          key={corner.edges.join("-")}
          edges={corner.edges}
          className={corner.className}
          context={handleContext}
        />
      ))}
    </div>,
    document.body,
  );
}

type ResizeHandleContext = {
  readonly geometryRef: { readonly current: FloatingPanelGeometry };
  readonly getLimits: () => Limits;
  readonly applyGeometry: (next: FloatingPanelGeometry) => void;
  readonly persistGeometry: () => void;
};

type PanelResizeHandleProps = {
  readonly edges: readonly Edge[];
  readonly className: string;
  readonly context: ResizeHandleContext;
  /** Set for the four edge handles: focusable, keyboard-resizable ARIA separator. Corners are pointer-only. */
  readonly separator?: {
    readonly label: string;
    readonly geometry: FloatingPanelGeometry;
    readonly limits: Limits;
  };
};

function PanelResizeHandle({
  edges,
  className,
  context,
  separator,
}: PanelResizeHandleProps): ReactNode {
  const drag = usePointerDrag({
    onStart: () => context.geometryRef.current,
    onMove: (start, delta) =>
      context.applyGeometry(resizeGeometry(start, edges, delta, context.getLimits())),
    onEnd: context.persistGeometry,
  });

  if (separator === undefined) {
    return <div aria-hidden="true" {...drag} className={className} />;
  }

  const [edge] = edges;
  const horizontalEdge = edge === "left" || edge === "right";
  const { geometry, limits } = separator;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const delta = arrowKeyDelta(event);
    if (delta === undefined || (horizontalEdge ? delta.dx === 0 : delta.dy === 0)) return;
    event.preventDefault();
    context.applyGeometry(
      resizeGeometry(context.geometryRef.current, edges, delta, context.getLimits()),
    );
    context.persistGeometry();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> can't carry pointer/keyboard drag interaction or a live size value — a draggable separator needs a div with the ARIA role.
    <div
      role="separator"
      aria-orientation={horizontalEdge ? "vertical" : "horizontal"}
      aria-label={separator.label}
      aria-valuenow={horizontalEdge ? geometry.width : geometry.height}
      aria-valuemin={horizontalEdge ? limits.minWidth : limits.minHeight}
      aria-valuemax={horizontalEdge ? limits.maxWidth : limits.maxHeight}
      tabIndex={0}
      {...drag}
      onKeyDown={onKeyDown}
      className={className}
    />
  );
}
